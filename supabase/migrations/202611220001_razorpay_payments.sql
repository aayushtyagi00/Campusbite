begin;

-- The database owner opts a dedicated sandbox into test payments. The application
-- service can read this setting but cannot switch a real vendor queue to test.
create table public.razorpay_environment (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('live','test'))
);
insert into public.razorpay_environment(mode) values ('live');
alter table public.razorpay_environment enable row level security;
revoke all on public.razorpay_environment from public, anon, authenticated, service_role;
grant select on public.razorpay_environment to service_role;

create table campusbite_private.razorpay_events (
  event_id text primary key,
  kind text not null,
  payment_id text not null,
  processed_at timestamptz not null default now()
);
revoke all on campusbite_private.razorpay_events from public, anon, authenticated, service_role;

-- Commit the delivery receipt and its business effect together. Failed processing
-- rolls back the receipt so Razorpay can retry; a concurrent delivery waits.
create function public.commerce_apply_razorpay_event(
  event_id text, kind text, payment_id text, gateway_order text, amount integer, currency text, key_mode text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  applied boolean;
begin
  if not exists (select 1 from public.razorpay_environment e where e.mode=key_mode)
    or event_id is null or length(event_id) not between 1 and 200
    or kind is null or kind not in ('payment.captured','refund.processed')
    or amount is null or amount<=0 or currency is distinct from 'INR'
    or payment_id is null or payment_id !~ '^pay_[A-Za-z0-9]+$' then return false; end if;
  insert into campusbite_private.razorpay_events values (event_id,kind,payment_id,now())
    on conflict do nothing;
  if not found then
    return exists(select 1 from campusbite_private.razorpay_events e where e.event_id=$1 and e.kind=$2 and e.payment_id=$3);
  end if;
  if kind='payment.captured' then
    applied := public.commerce_capture(gateway_order,payment_id,amount,currency);
  else
    applied := public.commerce_record_refund(payment_id,amount,'Succeeded');
    if not applied then
      select exists(select 1 from public.commerce_orders o where o.provider_payment=payment_id
        and o.amount_paise=amount and o.refund='Succeeded') into applied;
    end if;
  end if;
  if applied is distinct from true then raise exception 'Payment event needs reconciliation'; end if;
  return true;
end $$;
revoke all on function public.commerce_apply_razorpay_event(text,text,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.commerce_apply_razorpay_event(text,text,text,text,integer,text,text) to service_role;

commit;
