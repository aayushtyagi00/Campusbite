begin;

-- Link an approved CampusBite storefront slug to the shop that fulfills its orders.
create table public.commerce_stalls (
  slug text primary key,
  shop_id uuid not null unique references public.vendor_shops(id),
  capacity integer not null check (capacity between 1 and 100),
  enabled boolean not null default false
);

create table public.commerce_menu (
  id text primary key,
  stall_slug text not null,
  name text not null,
  category text not null check (category in ('Meals','Wraps','Drinks','Snacks')),
  description text not null,
  price integer not null check (price between 100 and 1000000),
  prep integer not null check (prep between 1 and 50),
  diet text not null,
  photo text not null,
  sold_out boolean not null default false
);
create index commerce_menu_stall on public.commerce_menu (stall_slug);

create table public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  request_id uuid not null,
  fingerprint text not null,
  shop_id uuid not null references public.vendor_shops(id),
  pickup_at timestamptz not null,
  reserved_until timestamptz not null,
  accept_until timestamptz,
  detail jsonb not null,
  amount_paise integer not null check (amount_paise >= 100),
  status text not null default 'unpaid' check (status in (
    'unpaid', 'awaiting', 'accepted', 'preparing', 'ready', 'collected', 'cancelled', 'expired', 'rejected'
  )),
  provider_order text unique,
  provider_payment text unique,
  refund text not null default 'None' check (refund in ('None', 'Requested', 'Pending', 'Succeeded')),
  refund_after timestamptz,
  support text check (length(support) between 1 and 300),
  pickup_code text not null default '',
  pickup_attempts integer not null default 0,
  pickup_retry_after timestamptz,
  events jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (student_id, request_id)
);
create index commerce_history on public.commerce_orders (student_id, created_at desc);
create index commerce_slot_usage on public.commerce_orders (shop_id, pickup_at);
create index commerce_accept_expiry on public.commerce_orders (accept_until) where status = 'awaiting';
create index commerce_reservation_expiry on public.commerce_orders (reserved_until) where status = 'unpaid';
create index commerce_refund_jobs on public.commerce_orders (refund_after) where refund in ('Requested', 'Pending');

alter table public.commerce_stalls enable row level security;
alter table public.commerce_menu enable row level security;
alter table public.commerce_orders enable row level security;
revoke all on public.commerce_stalls, public.commerce_orders from public, anon, authenticated;
revoke all on public.commerce_menu from public, anon, authenticated;
grant select on public.commerce_stalls, public.commerce_orders to service_role;
grant select on public.commerce_menu to service_role, authenticated;
grant update (price, sold_out) on public.commerce_menu to authenticated;
grant update (provider_order, support) on public.commerce_orders to service_role;

grant select, insert, update on public.commerce_stalls to authenticated;
create policy commerce_storefront_admin on public.commerce_stalls to authenticated
  using (campusbite_private.is_admin()) with check (campusbite_private.is_admin());

create policy commerce_storefront_staff on public.commerce_stalls for select to authenticated
  using (campusbite_private.has_shop_role(shop_id, array['owner','manager','staff']));

create policy commerce_menu_management on public.commerce_menu to authenticated
  using (campusbite_private.is_admin() or exists (
    select 1 from public.commerce_stalls s where s.slug = stall_slug
      and campusbite_private.has_shop_role(s.shop_id, array['owner','manager'])
  ));

alter table public.vendor_orders add column items jsonb not null default '[]';
alter table public.vendor_orders add column preparation_note text not null default '';
alter table public.vendor_orders drop constraint vendor_orders_status_check;
alter table public.vendor_orders add check (status in (
  'awaiting','accepted','preparing','ready','collected','cancelled','expired','rejected'
));
create index vendor_orders_active on public.vendor_orders (shop_id,pickup_at)
  where status in ('awaiting','accepted','preparing','ready');

create function public.commerce_reserve(
  actor uuid, request uuid, signature text, stall text, slot timestamptz, detail jsonb, amount integer
) returns public.commerce_orders
language plpgsql security definer set search_path = '' as $$
declare
  config public.commerce_stalls;
  existing public.commerce_orders;
  menu_size integer;
  current_amount integer;
  current_quantity integer;
  current_prep integer;
  all_available boolean;
  hold_until timestamptz;
begin
  -- Scope retries to the authenticated student and serialize active holds for that student.
  perform pg_advisory_xact_lock(hashtextextended('student:' || actor::text, 0));
  select * into existing from public.commerce_orders where student_id = actor and request_id = request;
  if found then
    if existing.fingerprint <> signature then raise exception 'Checkout changed'; end if;
    return existing;
  end if;
  if slot < clock_timestamp() + interval '5 minutes'
    or slot > clock_timestamp() + interval '60 minutes'
    or mod(extract(epoch from slot), 600) <> 0 then
    raise exception 'Invalid pickup window';
  end if;
  if (select count(*) from public.commerce_orders where student_id = actor and status = 'unpaid'
      and reserved_until > clock_timestamp()) >= 2 then
    raise exception 'Too many active checkout holds';
  end if;
  select * into config from public.commerce_stalls where slug = stall and enabled for share;
  if not found then raise exception 'Stall is unavailable'; end if;
  select count(*), sum(m.price * l.qty), sum(l.qty), greatest(4,max(m.prep)), bool_and(m.price = l.price and not m.sold_out and l.qty between 1 and 8)
    into menu_size, current_amount, current_quantity, current_prep, all_available
    from (
      select item.* from public.commerce_menu item
      where item.stall_slug = stall and item.id in (select value->>'id' from jsonb_array_elements(detail->'items'))
      order by item.id for share
    ) m
    join jsonb_to_recordset(detail->'items') l(id text, price integer, qty integer) on l.id = m.id;
  if menu_size = 0 or menu_size <> jsonb_array_length(detail->'items') or not coalesce(all_available,false)
    or current_amount is distinct from amount or current_quantity > 8 then
    raise exception 'An item or price changed';
  end if;
  -- Only attempts for the same shop and pickup window compete for capacity.
  perform pg_advisory_xact_lock(hashtextextended('slot:' || config.shop_id::text || ':' || extract(epoch from slot)::text, 0));
  if (select count(*) from public.commerce_orders where shop_id = config.shop_id and pickup_at = slot
      and (status in ('accepted','preparing','ready','collected')
           or (status = 'unpaid' and reserved_until > clock_timestamp())
           or (status = 'awaiting' and accept_until > clock_timestamp()))) >= config.capacity then
    raise exception 'Pickup window is full';
  end if;
  hold_until := least(slot - make_interval(mins => current_prep + (current_quantity - 1) * 2) - interval '3.5 minutes',
    clock_timestamp() + interval '5 minutes');
  if hold_until < clock_timestamp() + interval '30 seconds' then raise exception 'Choose a later pickup window'; end if;
  insert into public.commerce_orders (student_id, request_id, fingerprint, shop_id, pickup_at, reserved_until, detail, amount_paise)
  values (actor, request, signature, config.shop_id, slot, hold_until, detail, amount)
  returning * into existing;
  return existing;
end $$;

create function campusbite_private.commerce_set_status(order_id uuid, next_status text) returns void
language sql set search_path = '' as $$
  update public.commerce_orders set status = next_status,
    refund = case when next_status in ('cancelled','expired','rejected') and provider_payment is not null then 'Requested' else refund end,
    refund_after = case when next_status in ('cancelled','expired','rejected') and provider_payment is not null then clock_timestamp() else refund_after end,
    events = events || jsonb_build_array(jsonb_build_object('status', initcap(next_status), 'at', extract(epoch from clock_timestamp()) * 1000))
    where id = order_id;
  update public.vendor_orders set status = next_status where id = order_id;
$$;
revoke all on function campusbite_private.commerce_set_status(uuid,text) from public, anon, authenticated;

create function public.commerce_capture(gateway_order text, payment text, amount integer, currency text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  purchase public.commerce_orders;
begin
  select * into purchase from public.commerce_orders where provider_order = gateway_order;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('slot:' || purchase.shop_id::text || ':' || extract(epoch from purchase.pickup_at)::text, 0));
  select * into purchase from public.commerce_orders where provider_order = gateway_order for update;
  if not found or purchase.amount_paise <> amount or currency <> 'INR' then return false; end if;
  if purchase.provider_payment is not null then return purchase.provider_payment = payment; end if;
  update public.commerce_orders set provider_payment = payment,
    events = events || jsonb_build_array(jsonb_build_object('status','Payment captured','at',extract(epoch from clock_timestamp()) * 1000))
    where id = purchase.id;
  if purchase.status <> 'unpaid' or purchase.reserved_until <= clock_timestamp() then
    perform campusbite_private.commerce_set_status(purchase.id, 'expired');
    return true;
  end if;
  update public.commerce_orders set accept_until = clock_timestamp() + interval '90 seconds' where id = purchase.id;
  perform campusbite_private.commerce_set_status(purchase.id, 'awaiting');
  insert into public.vendor_orders (id, shop_id, reference, status, pickup_at, items, preparation_note)
    values (purchase.id, purchase.shop_id, 'CB-' || upper(substr(purchase.id::text,1,8)), 'awaiting',
      purchase.pickup_at, purchase.detail->'items', purchase.detail->>'note');
  return true;
end $$;

create function public.commerce_cancel(actor uuid, order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.commerce_orders where id = order_id and student_id = actor
    and status = 'awaiting' and accept_until > clock_timestamp() for update;
  if not found then return false; end if;
  perform campusbite_private.commerce_set_status(order_id, 'cancelled');
  return true;
end $$;

create function public.commerce_fulfill(order_id uuid, next_status text, submitted_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  purchase public.commerce_orders;
begin
  select * into purchase from public.commerce_orders where id = order_id
    and campusbite_private.has_shop_role(shop_id, array['owner','manager','staff']);
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('slot:' || purchase.shop_id::text || ':' || extract(epoch from purchase.pickup_at)::text, 0));
  select * into purchase from public.commerce_orders where id = order_id
    and campusbite_private.has_shop_role(shop_id, array['owner','manager','staff']) for update;
  if not found then return false; end if;
  if purchase.status = 'ready' and next_status = 'collected' then
    if purchase.pickup_attempts >= 5 and purchase.pickup_retry_after > clock_timestamp() then return false; end if;
    if purchase.pickup_code <> coalesce(submitted_code,'') then
      update public.commerce_orders set
        pickup_attempts = case when pickup_retry_after > clock_timestamp() then pickup_attempts + 1 else 1 end,
        pickup_retry_after = case when pickup_retry_after > clock_timestamp() then pickup_retry_after else clock_timestamp() + interval '5 minutes' end
        where id = purchase.id;
      return false;
    end if;
  end if;
  if not coalesce(
    (purchase.status = 'awaiting' and purchase.accept_until > clock_timestamp() and next_status in ('accepted','rejected'))
    or (purchase.status = 'accepted' and next_status = 'preparing')
    or (purchase.status = 'preparing' and next_status = 'ready')
    or (purchase.status = 'ready' and next_status = 'collected' and purchase.pickup_code <> '' and purchase.pickup_code = submitted_code), false
  ) then return false; end if;
  if next_status = 'ready' then
    update public.commerce_orders set pickup_code = lpad((
      ('x' || substr(gen_random_uuid()::text, 1, 8))::bit(32)::bigint % 1000000
    )::text, 6, '0') where id = purchase.id;
  elsif next_status = 'collected' then
    insert into public.vendor_sales (shop_id, reference, amount_paise)
      values (purchase.shop_id, purchase.id::text, purchase.amount_paise);
  end if;
  perform campusbite_private.commerce_set_status(order_id, next_status);
  return true;
end $$;

create function public.commerce_refund_jobs()
returns table (id uuid, payment text, amount integer)
language plpgsql security definer set search_path = '' as $$
declare expired uuid;
begin
  update public.commerce_orders o set status = 'expired'
    where o.id in (select j.id from public.commerce_orders j where j.status = 'unpaid' and j.reserved_until <= clock_timestamp()
      order by j.reserved_until limit 100 for update skip locked);
  for expired in select o.id from public.commerce_orders o where o.status = 'awaiting' and o.accept_until <= clock_timestamp()
    order by o.accept_until limit 100 for update skip locked loop
    perform campusbite_private.commerce_set_status(expired, 'expired');
  end loop;
  return query
    update public.commerce_orders o set refund_after = clock_timestamp() + interval '2 minutes'
    where o.id in (
      select j.id from public.commerce_orders j where j.refund in ('Requested','Pending') and j.refund_after <= clock_timestamp()
      order by j.refund_after limit 12 for update skip locked
    ) returning o.id, o.provider_payment, o.amount_paise;
end $$;

create function public.commerce_record_refund(payment text, amount integer, outcome text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if outcome not in ('Pending','Succeeded') then return false; end if;
  update public.commerce_orders set refund = outcome,
    refund_after = case when outcome = 'Succeeded' then null else clock_timestamp() + interval '10 minutes' end
    where provider_payment = payment and amount_paise = amount and refund in ('Requested','Pending');
  return found;
end $$;

revoke all on function public.commerce_reserve(uuid,uuid,text,text,timestamptz,jsonb,integer),
  public.commerce_capture(text,text,integer,text), public.commerce_cancel(uuid,uuid),
  public.commerce_fulfill(uuid,text,text), public.commerce_refund_jobs(),
  public.commerce_record_refund(text,integer,text) from public, anon, authenticated;
grant execute on function public.commerce_reserve(uuid,uuid,text,text,timestamptz,jsonb,integer),
  public.commerce_capture(text,text,integer,text), public.commerce_cancel(uuid,uuid),
  public.commerce_refund_jobs(), public.commerce_record_refund(text,integer,text) to service_role;
grant execute on function public.commerce_fulfill(uuid,text,text) to authenticated;
commit;
