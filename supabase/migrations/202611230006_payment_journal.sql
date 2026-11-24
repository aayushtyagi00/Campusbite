begin;
alter table public.commerce_orders add column latest_payment_attempt text;
grant update(latest_payment_attempt) on public.commerce_orders to service_role;
create table public.payment_journal (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.commerce_orders,
  kind text not null check(kind in ('capture','refund','extra_capture','extra_refund')),
  payment text not null, amount_paise integer not null check(amount_paise>0),
  recorded_at timestamptz not null default now(), unique(kind,payment)
);
alter table public.payment_journal enable row level security;
revoke all on public.payment_journal from public,anon,authenticated,service_role;
grant select on public.payment_journal to service_role;
create index payment_journal_order on public.payment_journal(order_id);
insert into public.payment_journal(order_id,kind,payment,amount_paise,recorded_at)
  select id,'capture',provider_payment,amount_paise,coalesce((select to_timestamp((e->>'at')::numeric/1000)
    from jsonb_array_elements(events) e where e->>'status'='Payment captured' limit 1),created_at)
  from public.commerce_orders where provider_payment is not null;
insert into public.payment_journal(order_id,kind,payment,amount_paise)
  select id,'refund',provider_payment,amount_paise from public.commerce_orders where provider_payment is not null and refund='Succeeded';
create function campusbite_private.record_captured_attempt() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind in ('capture','extra_capture') then
    insert into public.commerce_payment_attempts(payment_id,order_id,status,amount) values(new.payment,new.order_id,'captured',new.amount_paise)
    on conflict(payment_id) do update set status='captured',updated_at=now();
  end if;
  return new;
end $$;
create trigger capture_attempt after insert on public.payment_journal for each row execute function campusbite_private.record_captured_attempt();
insert into public.commerce_payment_attempts(payment_id,order_id,status,amount)
select payment,order_id,'captured',amount_paise from public.payment_journal where kind='capture' on conflict do nothing;

create function campusbite_private.journal_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider_payment is not null and old.provider_payment is null then
    insert into public.payment_journal(order_id,kind,payment,amount_paise) values(new.id,'capture',new.provider_payment,new.amount_paise);
  end if;
  if new.refund='Succeeded' and old.refund<>'Succeeded' then
    insert into public.payment_journal(order_id,kind,payment,amount_paise) values(new.id,'refund',new.provider_payment,new.amount_paise);
  end if;
  return new;
end $$;
create trigger journal_payment after update of provider_payment,refund on public.commerce_orders for each row execute function campusbite_private.journal_payment();

-- Record a verified extra payment without creating another kitchen ticket.
alter function public.commerce_apply_razorpay_event(text,text,text,text,integer,text,text) set schema campusbite_private;
revoke all on function campusbite_private.commerce_apply_razorpay_event(text,text,text,text,integer,text,text) from public,anon,authenticated,service_role;
create function public.commerce_apply_razorpay_event(event_id text,kind text,payment_id text,gateway_order text,amount integer,currency text,key_mode text)
returns boolean language plpgsql security definer set search_path='' as $$
declare target public.commerce_orders; entry public.payment_journal;
begin
  if kind='payment.captured' then
    select * into target from public.commerce_orders where provider_order=gateway_order;
    if target.provider_payment is null or target.provider_payment=payment_id then
      return campusbite_private.commerce_apply_razorpay_event(event_id,kind,payment_id,gateway_order,amount,currency,key_mode);
    end if;
  elsif kind='refund.processed' then
    select * into entry from public.payment_journal j where j.payment=payment_id and j.kind='extra_capture';
    if not found then return campusbite_private.commerce_apply_razorpay_event(event_id,kind,payment_id,gateway_order,amount,currency,key_mode); end if;
    select * into strict target from public.commerce_orders where id=entry.order_id;
  else return false;
  end if;
  if not exists(select 1 from public.razorpay_environment where mode=key_mode) or event_id is null or length(event_id) not between 1 and 200
    or payment_id is null or payment_id !~ '^pay_[A-Za-z0-9]+$' or amount is distinct from target.amount_paise or currency is distinct from 'INR' then return false; end if;
  insert into campusbite_private.razorpay_events values(event_id,kind,payment_id,now()) on conflict do nothing;
  if not found then return exists(select 1 from campusbite_private.razorpay_events e where e.event_id=$1 and e.kind=$2 and e.payment_id=$3); end if;
  insert into public.payment_journal(order_id,kind,payment,amount_paise) values(target.id,
    case when kind='payment.captured' then 'extra_capture' else 'extra_refund' end,payment_id,amount) on conflict do nothing;
  if kind='payment.captured' then
    update public.commerce_orders set recovery_error='Extra captured payment requires reconciliation' where id=target.id;
  elsif not exists(select 1 from public.payment_journal capture where capture.order_id=target.id and capture.kind='extra_capture'
    and not exists(select 1 from public.payment_journal refund where refund.payment=capture.payment and refund.kind='extra_refund')) then
    update public.commerce_orders set recovery_error=null where id=target.id and recovery_error='Extra captured payment requires reconciliation';
  end if;
  return true;
end $$;
revoke all on function public.commerce_apply_razorpay_event(text,text,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.commerce_apply_razorpay_event(text,text,text,text,integer,text,text) to service_role;

create table public.payment_webhook_queue(
  event_id text primary key, kind text not null, payment text not null, gateway_order text, refund_id text, amount integer not null, mode text not null,
  attempts integer not null default 0, due timestamptz not null default now(), completed_at timestamptz, error text
);
alter table public.payment_webhook_queue enable row level security;
revoke all on public.payment_webhook_queue from public,anon,authenticated,service_role;
grant select,insert,update(completed_at,error) on public.payment_webhook_queue to service_role;
create index webhook_due on public.payment_webhook_queue(due) where completed_at is null;
create function public.claim_payment_webhooks(key_mode text) returns setof public.payment_webhook_queue
language sql security definer set search_path='' as $$
  update public.payment_webhook_queue q set attempts=q.attempts+1,due=now()+make_interval(mins=>least(360,1<<least(q.attempts,9)))
  where q.event_id in (select j.event_id from public.payment_webhook_queue j where j.completed_at is null and j.due<=now() and j.mode=key_mode
    order by j.due limit 10 for update skip locked) returning q.*
$$;
revoke all on function public.claim_payment_webhooks(text) from public,anon,authenticated;
grant execute on function public.claim_payment_webhooks(text) to service_role;
create table public.commerce_worker_runs (
  id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(),
  finished_at timestamptz, outcome text not null default 'running', results jsonb
);
alter table public.commerce_worker_runs enable row level security;
revoke all on public.commerce_worker_runs from public,anon,authenticated,service_role;
grant select,insert,update(finished_at,outcome,results) on public.commerce_worker_runs to service_role;
create index worker_started on public.commerce_worker_runs(started_at desc);
create function public.commerce_ops_metrics() returns jsonb language sql stable security definer set search_path='' as $$
  with recent as (
    select o.*,(select min(to_timestamp((e->>'at')::numeric/1000)) from jsonb_array_elements(o.events) e where e->>'status'='Ready') as ready_at,
      exists(select 1 from jsonb_array_elements(o.events) e where e->>'status'='Accepted') as was_accepted
    from public.commerce_orders o where o.created_at>=now()-interval '7 days'
  ) select jsonb_build_object(
    'paid',count(*) filter(where provider_payment is not null),'accepted',count(*) filter(where was_accepted),
    'accepted_due',count(*) filter(where was_accepted and pickup_at+make_interval(mins=>pickup_minutes)<=now()),
    'on_time_due',count(*) filter(where was_accepted and pickup_at+make_interval(mins=>pickup_minutes)<=now() and ready_at<=pickup_at+make_interval(mins=>pickup_minutes)),
    'missed',count(*) filter(where status='expired' and provider_payment is not null and exists(select 1 from jsonb_array_elements(events) e where e->>'status'='Awaiting')),
    'uncollected',count(*) filter(where status='uncollected'),
    'failed_push',(select count(*) from campusbite_private.push_jobs where finished_at is null and attempts>=8 and error is not null)
  ) from recent
$$;
revoke all on function public.commerce_ops_metrics() from public,authenticated,anon;
grant execute on function public.commerce_ops_metrics() to service_role;
commit;
