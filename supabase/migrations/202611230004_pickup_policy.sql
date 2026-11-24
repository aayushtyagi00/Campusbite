begin;
alter table public.commerce_stalls
  add column advance_minutes integer not null default 60 check (advance_minutes between 15 and 360),
  add column acceptance_seconds integer not null default 90 check (acceptance_seconds between 30 and 300),
  add column buffer_minutes integer not null default 2 check (buffer_minutes between 0 and 30),
  add column last_pickup_minutes integer not null default 0 check (last_pickup_minutes between 0 and 180),
  add column holding_minutes integer check (holding_minutes between 5 and 240);
alter table public.commerce_orders add column holding_until timestamptz;
alter table public.commerce_orders drop constraint commerce_orders_status_check, add check(status in
  ('unpaid','awaiting','accepted','preparing','ready','collected','uncollected','cancelled','expired','rejected'));
alter table public.vendor_orders drop constraint vendor_orders_status_check, add check(status in
  ('awaiting','accepted','preparing','ready','collected','uncollected','cancelled','expired','rejected'));

create function public.vendor_set_pickup_policy(target_shop uuid,expected_revision integer,advance integer,
  acceptance integer,buffer integer,cutoff integer,holding integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager']) then raise insufficient_privilege; end if;
  update public.commerce_stalls set advance_minutes=advance,acceptance_seconds=acceptance,buffer_minutes=buffer,
    last_pickup_minutes=cutoff,holding_minutes=holding,revision=revision+1 where shop_id=target_shop and revision=expected_revision;
  if not found then raise exception 'Reload the latest shop settings'; end if;
end $$;
revoke all on function public.vendor_set_pickup_policy(uuid,integer,integer,integer,integer,integer,integer) from public,anon;
grant execute on function public.vendor_set_pickup_policy(uuid,integer,integer,integer,integer,integer,integer) to authenticated;

create or replace function campusbite_private.pickup_fits(s public.commerce_stalls, slot timestamptz, minutes integer)
returns boolean language sql stable set search_path='' as $$
  with candidate as (select slot at time zone 'Asia/Kolkata' as t),
  shifts as (
    select t, t::date - delta as d,
      (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])
        [extract(isodow from t::date-delta)::integer] as weekday
    from candidate cross join generate_series(0,1) delta
  ), hours as (
    select t,d,
      case when s.weekly_hours ? weekday then (s.weekly_hours->weekday->>'opens')::time else s.opens end as opening,
      case when s.weekly_hours ? weekday then (s.weekly_hours->weekday->>'closes')::time else s.closes end as closing
    from shifts
  )
  select exists(select 1 from hours where s.enabled and s.published and s.standing='approved'
    and not s.vendor_paused and minutes=s.pickup_minutes and opening<>closing
    and not d=any(s.closed_dates) and not t::date=any(s.closed_dates)
    and not (t+make_interval(mins=>minutes)-interval '1 microsecond')::date=any(s.closed_dates)
    and t>=d+opening and t+make_interval(mins=>minutes)<=d+(closing<opening)::integer+closing-make_interval(mins=>s.last_pickup_minutes)
    and mod(extract(epoch from t-(d+opening)),minutes*60)=0)
$$;

create or replace function public.commerce_pickup_availability(stall text, items jsonb, actor uuid default null, request uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  s public.commerce_stalls;
  held public.commerce_orders;
  basket record;
  checked_at timestamptz := statement_timestamp();
  windows jsonb;
begin
  if (select paused from public.ordering_control where singleton) then
    return jsonb_build_object('slots','[]'::jsonb,'message','Campus ordering is paused.');
  end if;
  select * into s from public.commerce_stalls where slug=stall and published and standing='approved';
  if not found then return jsonb_build_object('slots','[]'::jsonb,'message','Shop unavailable'); end if;
  if actor is not null and request is not null then
    select * into held from public.commerce_orders o where o.student_id=actor and o.request_id=request
      and o.shop_id=s.shop_id and o.status='unpaid' and o.reserved_until>checked_at
      and jsonb_array_length(o.detail->'items')=jsonb_array_length(items)
      and o.detail->'items' @> items;
  end if;
  select * into basket from campusbite_private.check_basket(s,items,checked_at);
  select coalesce(jsonb_agg(jsonb_build_object('start',extract(epoch from t)*1000,
    'end',extract(epoch from (t+make_interval(mins=>duration)))*1000) order by t),'[]') into windows
  from (
    select t,s.pickup_minutes as duration from generate_series(date_trunc('minute',checked_at),
      checked_at+make_interval(mins=>s.advance_minutes),interval '1 minute') t
    where t is distinct from held.pickup_at and basket.problem is null and t>=checked_at+make_interval(mins=>basket.prep)+make_interval(secs=>s.acceptance_seconds+30,mins=>s.buffer_minutes)
      and campusbite_private.pickup_fits(s,t,s.pickup_minutes)
      and campusbite_private.has_pickup_capacity(s,t,s.pickup_minutes,checked_at)
    union select held.pickup_at,held.pickup_minutes where held.id is not null
  ) offered;
  return jsonb_build_object('slots',windows,'message',case when windows='[]'::jsonb then coalesce(basket.problem,case
      when not s.enabled then 'This stall is accepting menu views only. Paid ordering is disabled.'
      when s.vendor_paused then 'The vendor has paused new orders.'
      when not exists(select 1 from generate_series(date_trunc('minute',checked_at),checked_at+make_interval(mins=>s.advance_minutes),interval '1 minute') candidate
        where campusbite_private.pickup_fits(s,candidate,s.pickup_minutes)) then
        format('No scheduled pickup window fits in the next %s minutes. Check the weekday hours, pickup cutoff and closure dates.',s.advance_minutes)
      when not exists(select 1 from generate_series(date_trunc('minute',checked_at),checked_at+make_interval(mins=>s.advance_minutes),interval '1 minute') candidate
        where campusbite_private.pickup_fits(s,candidate,s.pickup_minutes) and candidate >= checked_at+make_interval(mins=>basket.prep+s.buffer_minutes,secs=>s.acceptance_seconds+30)) then
        'The remaining windows are too soon to prepare this bag.'
      else 'All suitable pickup windows are full. Refresh to check again.' end) end);
end $$;

create or replace function public.commerce_reserve(
  actor uuid, request uuid, signature text, stall text, slot timestamptz, detail jsonb, amount integer
) returns public.commerce_orders
language plpgsql security definer set search_path = '' as $$
declare
  config public.commerce_stalls;
  existing public.commerce_orders;
  basket record;
  checked_at timestamptz;
  hold_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('student:' || actor::text, 0));
  select * into existing from public.commerce_orders where student_id=actor and request_id=request;
  if found then
    if existing.fingerprint<>signature then raise exception 'Checkout changed'; end if;
    return existing;
  end if;
  -- Serialize allocation across all overlapping windows and shared items at one shop.
  select * into config from public.commerce_stalls where slug=stall for update;
  if not found then raise exception 'Stall unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('slot:' || config.shop_id::text || ':' || extract(epoch from slot)::text,0));
  perform 1 from public.commerce_menu m where m.stall_slug=stall and m.id in
    (select value->>'id' from jsonb_array_elements(detail->'items')) order by m.id for share;
  checked_at := clock_timestamp();
  if slot>checked_at+make_interval(mins=>config.advance_minutes) or not campusbite_private.pickup_fits(config,slot,coalesce((detail->>'pickup_minutes')::integer,10)) then
    raise exception 'Choose a new pickup window';
  end if;
  if (select count(*) from public.commerce_orders where student_id=actor and status='unpaid' and reserved_until>checked_at)>=2 then
    raise exception 'Too many active checkout holds';
  end if;
  select * into basket from campusbite_private.check_basket(config,detail->'items',checked_at);
  if basket.problem is not null then raise exception '%',basket.problem; end if;
  if basket.total is distinct from amount then raise exception 'An item or price changed'; end if;
  if not campusbite_private.has_pickup_capacity(config,slot,config.pickup_minutes,checked_at) then raise exception 'Pickup window is full'; end if;
  hold_until := least(slot-make_interval(mins=>basket.prep)-make_interval(secs=>config.acceptance_seconds,mins=>config.buffer_minutes),checked_at+interval '2 minutes');
  if hold_until<checked_at+interval '30 seconds' then raise exception 'Choose a later pickup window'; end if;
  detail := detail || jsonb_build_object('acceptance_seconds',config.acceptance_seconds,'buffer_minutes',config.buffer_minutes,'holding_minutes',config.holding_minutes);
  insert into public.commerce_orders(student_id,request_id,fingerprint,shop_id,pickup_at,reserved_until,detail,amount_paise)
    values(actor,request,signature,config.shop_id,slot,hold_until,detail,amount) returning * into existing;
  return existing;
end $$;

create or replace function public.commerce_capture(gateway_order text, payment text, amount integer, currency text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  purchase public.commerce_orders;
  config public.commerce_stalls;
  basket record;
  checked_at timestamptz;
  late boolean;
  feasible boolean := true;
  committed jsonb;
begin
  select * into purchase from public.commerce_orders where provider_order=gateway_order;
  if not found then return false; end if;
  -- Take locks in the same order as reservations. A duplicate callback sees the
  -- first transaction's payment, stock allocation and vendor ticket together.
  select * into config from public.commerce_stalls where shop_id=purchase.shop_id for update;
  perform pg_advisory_xact_lock(hashtextextended('slot:' || purchase.shop_id::text || ':' || extract(epoch from purchase.pickup_at)::text,0));
  select * into purchase from public.commerce_orders where provider_order=gateway_order for update;
  if purchase.amount_paise is distinct from amount or currency is distinct from 'INR' or nullif(payment,'') is null then return false; end if;
  if purchase.provider_payment is not null then return purchase.provider_payment=payment; end if;
  perform 1 from public.commerce_menu m where m.stall_slug=config.slug and m.id in
    (select value->>'id' from jsonb_array_elements(purchase.detail->'items')) order by m.id for update;
  checked_at := clock_timestamp();
  late := purchase.reserved_until<=checked_at or purchase.status='expired';
  if purchase.status not in ('unpaid','expired') or config.shop_id is null then
    feasible := false;
  elsif late then
    select * into basket from campusbite_private.check_basket(config,purchase.detail->'items',checked_at,purchase.id,false);
    feasible := basket.problem is null
      and purchase.pickup_at >= checked_at + make_interval(secs=>coalesce((purchase.detail->>'acceptance_seconds')::integer,90),mins=>coalesce((purchase.detail->>'buffer_minutes')::integer,2))
        + make_interval(mins=>greatest(basket.prep,(purchase.detail->>'prep_minutes')::integer))
      and campusbite_private.pickup_fits(config,purchase.pickup_at,purchase.pickup_minutes)
      and campusbite_private.has_pickup_capacity(config,purchase.pickup_at,purchase.pickup_minutes,checked_at,purchase.id);
  end if;
  update public.commerce_orders set provider_payment=payment,
    events=events||jsonb_build_array(jsonb_build_object('status','Payment captured','at',extract(epoch from checked_at)*1000)) where id=purchase.id;
  if not feasible then
    perform campusbite_private.commerce_set_status(purchase.id,'expired');
    return true;
  end if;
  with allocations as (
    update public.commerce_menu m set stock_remaining=m.stock_remaining-i.qty
    from jsonb_to_recordset(purchase.detail->'items') i(id text,qty integer)
    where m.id=i.id and m.stall_slug=config.slug and m.stock_remaining is not null
    returning m.id,i.qty
  ) select coalesce(jsonb_agg(to_jsonb(a)),'[]') into committed from allocations a;
  update public.commerce_orders set stock_committed=committed,accept_until=checked_at+make_interval(secs=>coalesce((purchase.detail->>'acceptance_seconds')::integer,90)) where id=purchase.id;
  perform campusbite_private.commerce_set_status(purchase.id,'awaiting');
  insert into public.vendor_orders(id,shop_id,reference,status,pickup_at,items,preparation_note)
    values(purchase.id,purchase.shop_id,'CB-'||upper(substr(purchase.id::text,1,8)),'awaiting',purchase.pickup_at,
      purchase.detail->'items',coalesce(purchase.detail->>'note',''));
  return true;
end $$;

create function campusbite_private.set_holding_deadline() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='ready' and old.status='preparing' and new.detail->>'holding_minutes' is not null then
    new.holding_until := greatest(now(),new.pickup_at+make_interval(mins=>new.pickup_minutes))
      +make_interval(mins=>(new.detail->>'holding_minutes')::integer);
  end if;
  return new;
end $$;
create trigger set_holding_deadline before update of status on public.commerce_orders for each row execute function campusbite_private.set_holding_deadline();
create index holding_deadlines on public.commerce_orders(holding_until) where status='ready';
create function public.expire_uncollected() returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  for target in select id from public.commerce_orders where status='ready' and holding_until<=now()
    order by holding_until limit 100 for update skip locked loop
    perform campusbite_private.commerce_set_status(target,'uncollected');
  end loop;
end $$;
revoke all on function public.expire_uncollected() from public,anon,authenticated;
grant execute on function public.expire_uncollected() to service_role;
create or replace function public.vendor_order_feed(target_shop uuid, selected_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager','staff']) then raise insufficient_privilege; end if;
  return (with active as (
    select * from public.vendor_orders where shop_id=target_shop and status in ('awaiting','accepted','preparing','ready')
      and (selected_order is null or id=selected_order)
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
