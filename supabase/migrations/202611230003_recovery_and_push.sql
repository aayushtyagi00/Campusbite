begin;
alter table public.commerce_orders add column recovery_due timestamptz default (now()+interval '2 minutes'),
  add column recovery_count integer not null default 0, add column recovery_error text, add column refund_error text, add column provider_refund text;
create index commerce_recovery_due on public.commerce_orders(recovery_due)
  where provider_order is not null and provider_payment is null;
create table public.commerce_payment_attempts (
  payment_id text primary key, order_id uuid not null references public.commerce_orders,
  status text not null, amount integer not null, updated_at timestamptz not null default now()
);
alter table public.commerce_payment_attempts enable row level security;
revoke all on public.commerce_payment_attempts from public,anon,authenticated;
grant select,insert,update on public.commerce_payment_attempts to service_role;
grant update(recovery_error,refund_error,provider_refund) on public.commerce_orders to service_role;
create function public.claim_payment_recovery() returns table(id uuid,provider_order text,amount_paise integer)
language sql security definer set search_path='' as $$
  update public.commerce_orders o set recovery_count=o.recovery_count+1,
    recovery_due=clock_timestamp()+make_interval(mins=>least(720,2*(1<<least(o.recovery_count,9))))
  where o.id in (select q.id from public.commerce_orders q where q.provider_payment is null and q.provider_order is not null
    and q.recovery_due<=now() and q.created_at>now()-interval '7 days' order by q.recovery_due limit 8 for update skip locked)
  returning o.id,o.provider_order,o.amount_paise
$$;
create table public.push_subscriptions (
  endpoint text primary key, revoke_token uuid not null unique default gen_random_uuid(), keys jsonb not null, audience text not null check(audience in ('student','vendor','admin')),
  order_alerts boolean not null default true, refund_alerts boolean not null default true,
  student_id uuid, email text, shop_id uuid references public.vendor_shops, updated_at timestamptz not null default now()
);
create table campusbite_private.push_jobs (
  id bigint generated always as identity primary key, endpoint text references public.push_subscriptions on delete cascade,
  order_id uuid not null references public.commerce_orders, topic text not null, body text not null, due timestamptz not null default now(),
  attempts integer not null default 0, lease uuid, error text, finished_at timestamptz
);
create index push_due on campusbite_private.push_jobs(due) where finished_at is null;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.push_subscriptions to service_role;
create function campusbite_private.enqueue_order_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status<>old.status then
    insert into campusbite_private.push_jobs(endpoint,order_id,topic,body)
      select endpoint,new.id,'order','Order CB-'||upper(left(new.id::text,8))||' · '||new.status
      from public.push_subscriptions where audience='student' and student_id=new.student_id;
    if new.status='awaiting' then
      insert into campusbite_private.push_jobs(endpoint,order_id,topic,body,due)
        select endpoint,new.id,kind,msg,run_at from public.push_subscriptions cross join
          (values ('new','A paid order needs acceptance',now()),('deadline','An order is approaching its acceptance deadline',new.accept_until-interval '30 seconds')) v(kind,msg,run_at)
        where audience='vendor' and shop_id=new.shop_id;
    end if;
  end if;
  if new.refund<>old.refund then
    insert into campusbite_private.push_jobs(endpoint,order_id,topic,body)
      select endpoint,new.id,'refund','Order CB-'||upper(left(new.id::text,8))||' · refund '||new.refund
      from public.push_subscriptions where audience='student' and student_id=new.student_id;
  end if;
  if (new.recovery_error is not null and new.recovery_error is distinct from old.recovery_error)
    or (new.refund_error is not null and new.refund_error is distinct from old.refund_error) then
    insert into campusbite_private.push_jobs(endpoint,order_id,topic,body)
      select endpoint,new.id,'exception','A payment needs review in Commerce operations'
      from public.push_subscriptions where audience='admin';
  end if;
  return new;
end $$;
create trigger order_push after update of status,refund,recovery_error,refund_error on public.commerce_orders for each row execute function campusbite_private.enqueue_order_push();
create function public.claim_order_push() returns table(id bigint,lease uuid,endpoint text,keys jsonb,body text,audience text)
language sql security definer set search_path='' as $$
  with claimed as (
    update campusbite_private.push_jobs j set lease=gen_random_uuid(),attempts=j.attempts+1,due=now()+interval '2 minutes'
    where j.id in(select q.id from campusbite_private.push_jobs q where q.finished_at is null and q.attempts<8 and q.due<=now()
      order by q.due limit 40 for update skip locked) returning j.*
  ) select j.id,j.lease,s.endpoint,s.keys,j.body,s.audience from claimed j join public.push_subscriptions s using(endpoint)
    join public.commerce_orders o on o.id=j.order_id
    where (s.audience='student' and j.topic in ('order','refund') and s.student_id=o.student_id
      and (case when j.topic='refund' then s.refund_alerts else s.order_alerts end))
    or (s.audience='vendor' and j.topic in ('new','deadline') and o.status='awaiting' and o.accept_until>now() and s.shop_id=o.shop_id
      and exists(select 1 from public.vendor_access a where a.email=s.email and a.shop_id=s.shop_id))
    or (s.audience='admin' and j.topic='exception' and exists(select 1 from public.staff_admins a where a.email=s.email))
$$;
create function public.finish_order_push(job bigint,claim uuid,problem text) returns void
language sql security definer set search_path='' as $$
  update campusbite_private.push_jobs set error=problem,finished_at=case when problem is null then now() end,
    due=now()+make_interval(mins=>least(240,1<<least(attempts,7))) where id=job and lease=claim and finished_at is null
$$;
revoke all on function public.claim_payment_recovery(),public.claim_order_push(),public.finish_order_push(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_payment_recovery(),public.claim_order_push(),public.finish_order_push(bigint,uuid,text) to service_role;
commit;
