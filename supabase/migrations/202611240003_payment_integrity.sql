begin;

-- Active kitchen tickets and paid statuses are written by owner-executed
-- commerce functions. Keep the app service's direct updates limited to the
-- fields it actually writes, even on installations with default table grants.
revoke all on public.commerce_orders from service_role;
grant select, update(provider_order,support,recovery_error,refund_error,provider_refund,latest_payment_attempt)
  on public.commerce_orders to service_role;
revoke insert,update,delete,truncate on public.vendor_orders,public.vendor_sales from service_role;
revoke execute on function public.commerce_capture(text,text,integer,text) from public,anon,authenticated,service_role;

-- Capture already holds the shop row lock. Two orders can share the first
-- eight UUID digits without losing a paid order to the ticket's unique key.
create function campusbite_private.disambiguate_ticket_reference() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.reference='CB-'||upper(left(new.id::text,8)) and exists (
    select 1 from public.vendor_orders t where t.shop_id=new.shop_id and t.reference=new.reference
  ) then
    new.reference := 'CB-'||upper(new.id::text);
    update public.commerce_orders set detail=jsonb_set(detail,'{reference}',to_jsonb(new.reference))
      where id=new.id and shop_id=new.shop_id;
  end if;
  return new;
end $$;
revoke all on function campusbite_private.disambiguate_ticket_reference() from public,anon,authenticated,service_role;
create trigger disambiguate_ticket_reference before insert on public.vendor_orders
  for each row execute function campusbite_private.disambiguate_ticket_reference();

create function campusbite_private.has_captured_funds(purchase public.commerce_orders)
returns boolean language sql stable set search_path='' as $$
  select purchase.provider_order is not null and purchase.refund='None' and exists (
    select 1 from public.payment_journal j where j.order_id=purchase.id and j.kind='capture'
      and j.payment=purchase.provider_payment and j.amount_paise=purchase.amount_paise
  )
$$;
revoke all on function campusbite_private.has_captured_funds(public.commerce_orders)
  from public,anon,authenticated,service_role;

create function campusbite_private.require_captured_funds() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or old.status is distinct from new.status then
    if not campusbite_private.has_captured_funds(new) then
      raise exception 'A verified payment is required before fulfillment';
    end if;
  end if;
  return new;
end $$;
revoke all on function campusbite_private.require_captured_funds() from public,anon,authenticated,service_role;
create trigger require_captured_funds before insert or update of status on public.commerce_orders
  for each row when (new.status in ('awaiting','accepted','preparing','ready','collected'))
  execute function campusbite_private.require_captured_funds();

create or replace function public.student_pickup_codes(actor uuid,targets uuid[]) returns table(id uuid,code text)
language sql stable security definer set search_path='' as $$
  select o.id,campusbite_private.handoff_code(o.id) from public.commerce_orders o
    where o.student_id=actor and o.id=any(targets) and o.status in ('accepted','preparing','ready')
      and campusbite_private.has_captured_funds(o)
$$;

-- A verified full refund can originate with the merchant at Razorpay before
-- CampusBite has requested a refund. Close any open ticket in this transaction.
create or replace function public.commerce_record_refund(payment text, amount integer, outcome text)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  purchase public.commerce_orders;
  cancel_ticket boolean;
begin
  if outcome is null or outcome not in ('Pending','Succeeded') then return false; end if;
  select * into purchase from public.commerce_orders
    where provider_payment=payment and amount_paise=amount for update;
  if not found then return false; end if;
  if purchase.refund='Succeeded' then return outcome='Succeeded'; end if;
  if outcome='Pending' and purchase.refund not in ('Requested','Pending') then return false; end if;
  cancel_ticket := outcome='Succeeded' and purchase.status in ('awaiting','accepted','preparing','ready');
  update public.commerce_orders set refund=outcome,
    status=case when cancel_ticket then 'cancelled' else status end,
    events=case when cancel_ticket then events||jsonb_build_array(jsonb_build_object(
      'status','Cancelled','at',extract(epoch from clock_timestamp())*1000)) else events end,
    refund_after=case when outcome='Succeeded' then null else clock_timestamp()+interval '10 minutes' end
    where id=purchase.id;
  if cancel_ticket then
    update public.vendor_orders set status='cancelled' where id=purchase.id;
  end if;
  return true;
end $$;

-- Retry previously quarantined full refunds against the provider through the
-- ordinary verifier. No refund is issued by this migration.
update public.payment_webhook_queue q set attempts=0,due=now()
  where q.kind='refund.processed' and q.completed_at is null and q.attempts>=12
    and exists(select 1 from public.razorpay_environment e where e.mode=q.mode)
    and exists(select 1 from public.commerce_orders o where o.provider_payment=q.payment
      and q.amount between 1 and o.amount_paise and o.refund='None');

create or replace function public.vendor_order_feed(target_shop uuid, selected_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager','staff']) then raise insufficient_privilege; end if;
  return (with active as (
    select v.* from public.vendor_orders v join public.commerce_orders o on o.id=v.id and o.shop_id=v.shop_id
      where v.shop_id=target_shop and v.status in ('awaiting','accepted','preparing','ready')
      and o.status=v.status and campusbite_private.has_captured_funds(o)
      and (selected_order is null or v.id=selected_order)
  ), recent as (
    select * from public.vendor_orders where shop_id=target_shop and status not in ('awaiting','accepted','preparing','ready')
      and (selected_order is null or id=selected_order) order by pickup_at desc,id limit 30
  ), visible as (select * from active union all select * from recent)
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'shop_id',v.shop_id,'reference',v.reference,'status',v.status,
    'pickup_at',v.pickup_at,'pickup_minutes',coalesce(c.pickup_minutes,10),'items',v.items,'preparation_note',v.preparation_note,'accept_until',c.accept_until,
    'buffer_minutes',coalesce((c.detail->>'buffer_minutes')::integer,2),'holding_until',c.holding_until,
    'prep_minutes',coalesce((c.detail->>'prep_minutes')::integer,estimate.minutes),
    'rejection_reason',c.detail->>'rejection_reason','amount_paise',c.amount_paise,'refund',c.refund,
    'events',case when selected_order is not null then coalesce(c.events,'[]'::jsonb) else '[]'::jsonb end)
    order by v.pickup_at,v.id),'[]'::jsonb)
  from visible v left join public.commerce_orders c on c.id=v.id and c.shop_id=v.shop_id
  left join lateral (select case when count(i.qty)>0 then greatest(4,max(m.prep))+2*greatest(0,sum(i.qty)-1) end as minutes
    from jsonb_to_recordset(v.items) i(id text,qty integer) left join public.commerce_menu m on m.id=i.id) estimate
    on c.detail->>'prep_minutes' is null);
end $$;

commit;
