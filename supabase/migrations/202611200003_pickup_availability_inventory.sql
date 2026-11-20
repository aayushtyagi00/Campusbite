begin;

alter table public.commerce_menu add column stock_remaining integer check (stock_remaining >= 0);
-- Record exactly which units were deducted, including when tracking is later toggled.
alter table public.commerce_orders add column stock_committed jsonb not null default '[]';
create index commerce_unpaid_stock_holds on public.commerce_orders(shop_id,reserved_until)
  where status='unpaid' and provider_payment is null;

create function campusbite_private.held_units(shop uuid, item text, at_time timestamptz, skip_order uuid default null)
returns integer language sql stable set search_path='' as $$
  select coalesce(sum(i.qty),0)::integer from public.commerce_orders o
  cross join lateral jsonb_to_recordset(o.detail->'items') i(id text,qty integer)
  where o.shop_id=shop and o.status='unpaid' and o.provider_payment is null and o.reserved_until>at_time
    and o.id is distinct from skip_order and i.id=item
$$;

create function campusbite_private.pickup_fits(s public.commerce_stalls, slot timestamptz, minutes integer)
returns boolean language plpgsql stable set search_path='' as $$
declare
  local_slot timestamp := slot at time zone 'Asia/Kolkata';
  day_key text := (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[extract(isodow from local_slot)::int];
  opening time := s.opens;
  closing time := s.closes;
begin
  if s.weekly_hours ? day_key then
    opening := (s.weekly_hours->day_key->>'opens')::time;
    closing := (s.weekly_hours->day_key->>'closes')::time;
  end if;
  return coalesce(s.enabled and s.published and s.standing='approved' and not s.vendor_paused
    and not local_slot::date=any(s.closed_dates) and minutes=s.pickup_minutes
    and local_slot>=local_slot::date+opening and local_slot+make_interval(mins=>minutes)<=local_slot::date+closing
    and mod(extract(epoch from local_slot-(local_slot::date+opening)),minutes*60)=0,false);
end $$;

create function campusbite_private.has_pickup_capacity(s public.commerce_stalls, slot timestamptz,
  minutes integer, at_time timestamptz, skip_order uuid default null) returns boolean
language sql stable set search_path='' as $$
  select count(*)<s.capacity from public.commerce_orders o where o.shop_id=s.shop_id and o.id is distinct from skip_order
    and o.pickup_at<slot+make_interval(mins=>minutes) and o.pickup_at>slot-interval '60 minutes'
    and o.pickup_at+make_interval(mins=>o.pickup_minutes)>slot and (
      o.status in ('accepted','preparing','ready','collected') or (o.status='unpaid' and o.reserved_until>at_time)
      or (o.status='awaiting' and o.accept_until>at_time))
$$;

create function campusbite_private.check_basket(s public.commerce_stalls, items jsonb, at_time timestamptz,
  skip_order uuid default null, check_prices boolean default true)
returns table(problem text, prep integer, total integer)
language sql stable set search_path='' as $$
  select case
    when count(*)=0 or count(*)<>count(distinct i.id) or count(*)<>count(m.id)
      or not bool_and(coalesce(i.qty between 1 and 8,false)) or sum(i.qty)>s.basket_limit then 'Review the items and quantities in your bag'
    when bool_or(m.sold_out or m.archived) then 'An item is no longer available'
    when check_prices and bool_or(m.price is distinct from i.price) then 'An item price changed. Review your bag'
    when bool_or(m.stock_remaining is not null and m.stock_remaining-campusbite_private.held_units(s.shop_id,m.id,at_time,skip_order)<i.qty)
      then 'There is not enough stock for this bag'
    end, (greatest(4,max(m.prep))+2*greatest(0,sum(i.qty)-1))::integer, sum(m.price*i.qty)::integer
  from jsonb_to_recordset(items) i(id text,qty integer,price integer)
  left join public.commerce_menu m on m.id=i.id and m.stall_slug=s.slug
$$;

-- Only window times and a basket-level message leave the database. A verified
-- shopper may resume their own matching, unexpired hold even when it fills the slot.
create function public.commerce_pickup_availability(stall text, items jsonb, actor uuid default null, request uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  s public.commerce_stalls;
  held public.commerce_orders;
  basket record;
  checked_at timestamptz := statement_timestamp();
  windows jsonb;
begin
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
      checked_at+interval '60 minutes',interval '1 minute') t
    where t is distinct from held.pickup_at and basket.problem is null and t>=checked_at+make_interval(mins=>basket.prep)+interval '4 minutes'
      and campusbite_private.pickup_fits(s,t,s.pickup_minutes)
      and campusbite_private.has_pickup_capacity(s,t,s.pickup_minutes,checked_at)
    union select held.pickup_at,held.pickup_minutes where held.id is not null
  ) offered;
  return jsonb_build_object('slots',windows,'message',case when windows='[]'::jsonb then basket.problem end);
end $$;
revoke all on function public.commerce_pickup_availability(text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.commerce_pickup_availability(text,jsonb,uuid,uuid) to service_role;

create function campusbite_private.check_stock_count() returns trigger
language plpgsql security definer set search_path='' as $$
declare shop uuid;
begin
  if new.stock_remaining is not null and (old.stock_remaining is null or new.stock_remaining<old.stock_remaining) then
    select shop_id into shop from public.commerce_stalls where slug=new.stall_slug;
    if new.stock_remaining<campusbite_private.held_units(shop,new.id,clock_timestamp()) then
      raise exception 'Stock cannot be reduced below units held in checkout';
    end if;
  end if;
  return new;
end $$;
create trigger validate_stock_count before update of stock_remaining on public.commerce_menu
  for each row execute function campusbite_private.check_stock_count();


create or replace function public.vendor_write_item(target_shop uuid, item_id text, expected_revision integer, fields jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  stall text;
  name_value text := btrim(fields->>'name');
  archived_value boolean := (fields->>'archived')::boolean;
  sold_value boolean := archived_value or (fields->>'sold_out')::boolean;
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager']) then raise exception 'Shop management access required'; end if;
  select slug into strict stall from public.commerce_stalls where shop_id=target_shop for share;
  if length(name_value) not between 1 and 100 or length(btrim(fields->>'description')) not between 1 and 500 or
    length(btrim(fields->>'diet')) not between 1 and 80 or length(fields->>'photo')>200 then raise exception 'Check the menu item details'; end if;
  if expected_revision=-1 then
    insert into public.commerce_menu(id,stall_slug,name,category,description,price,prep,diet,photo,sold_out,archived,stock_remaining)
      values(item_id,stall,name_value,fields->>'category',fields->>'description',(fields->>'price')::int,(fields->>'prep')::int,
        fields->>'diet',fields->>'photo',sold_value,archived_value,(fields->>'stock_remaining')::integer);
  else
    update public.commerce_menu set name=name_value,category=fields->>'category',description=fields->>'description',
      price=(fields->>'price')::int, prep=(fields->>'prep')::int, diet=fields->>'diet',photo=fields->>'photo',
      stock_remaining=case when fields ? 'stock_remaining' then (fields->>'stock_remaining')::integer else stock_remaining end,
      sold_out=sold_value,archived=archived_value where id=item_id and stall_slug=stall and revision=expected_revision;
    if not found then raise exception 'Menu item changed. Reload before saving'; end if;
  end if;
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
  if slot>checked_at+interval '60 minutes' or not campusbite_private.pickup_fits(config,slot,coalesce((detail->>'pickup_minutes')::integer,10)) then
    raise exception 'Choose a new pickup window';
  end if;
  if (select count(*) from public.commerce_orders where student_id=actor and status='unpaid' and reserved_until>checked_at)>=2 then
    raise exception 'Too many active checkout holds';
  end if;
  select * into basket from campusbite_private.check_basket(config,detail->'items',checked_at);
  if basket.problem is not null then raise exception '%',basket.problem; end if;
  if basket.total is distinct from amount then raise exception 'An item or price changed'; end if;
  if not campusbite_private.has_pickup_capacity(config,slot,config.pickup_minutes,checked_at) then raise exception 'Pickup window is full'; end if;
  hold_until := least(slot-make_interval(mins=>basket.prep)-interval '3.5 minutes',checked_at+interval '5 minutes');
  if hold_until<checked_at+interval '30 seconds' then raise exception 'Choose a later pickup window'; end if;
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
      and purchase.pickup_at >= checked_at + interval '3.5 minutes'
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
  update public.commerce_orders set stock_committed=committed,accept_until=checked_at+interval '90 seconds' where id=purchase.id;
  perform campusbite_private.commerce_set_status(purchase.id,'awaiting');
  insert into public.vendor_orders(id,shop_id,reference,status,pickup_at,items,preparation_note)
    values(purchase.id,purchase.shop_id,'CB-'||upper(substr(purchase.id::text,1,8)),'awaiting',purchase.pickup_at,
      purchase.detail->'items',coalesce(purchase.detail->>'note',''));
  return true;
end $$;

-- Acceptance can turn a deadline-limited ticket into an ongoing commitment.
-- Serialize it with capacity checks, including across grids changed mid-service.
create or replace function public.commerce_fulfill(order_id uuid,next_status text,submitted_code text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if next_status='rejected' then return false; end if;
  if next_status='accepted' then
    perform 1 from public.commerce_stalls s join public.commerce_orders o on o.shop_id=s.shop_id
      where o.id=order_id and campusbite_private.has_shop_role(o.shop_id,array['owner','manager','staff']) for update of s;
    if not found then return false; end if;
  end if;
  return campusbite_private.commerce_fulfill(order_id,next_status,submitted_code);
end $$;

create function campusbite_private.release_paid_stock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.commerce_menu m where m.id in
    (select value->>'id' from jsonb_array_elements(old.stock_committed)) order by m.id for update;
  update public.commerce_menu m set stock_remaining=m.stock_remaining+i.qty
    from jsonb_to_recordset(old.stock_committed) i(id text,qty integer)
    where m.id=i.id and m.stock_remaining is not null;
  new.stock_committed := '[]';
  return new;
end $$;
create trigger release_paid_stock before update of status on public.commerce_orders for each row
  when (old.status='awaiting' and new.status in ('rejected','cancelled','expired') and old.stock_committed<>'[]'::jsonb)
  execute function campusbite_private.release_paid_stock();

revoke all on function campusbite_private.held_units(uuid,text,timestamptz,uuid),
  campusbite_private.pickup_fits(public.commerce_stalls,timestamptz,integer),
  campusbite_private.has_pickup_capacity(public.commerce_stalls,timestamptz,integer,timestamptz,uuid),
  campusbite_private.check_basket(public.commerce_stalls,jsonb,timestamptz,uuid,boolean),
  campusbite_private.check_stock_count(),campusbite_private.release_paid_stock() from public,anon,authenticated;
commit;
