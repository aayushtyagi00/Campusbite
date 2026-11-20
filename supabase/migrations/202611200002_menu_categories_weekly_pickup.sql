begin;

alter table public.commerce_stalls
  add column menu_categories text[] not null default array['Meals','Wraps','Drinks','Snacks'],
  add column weekly_hours jsonb not null default '{}',
  add column pickup_minutes integer not null default 10 check (pickup_minutes between 1 and 60);
-- Historical purchases retain the ten-minute duration used when they were placed.
alter table public.commerce_orders add column pickup_minutes integer not null default 10 check (pickup_minutes between 1 and 60);
alter table public.commerce_menu drop constraint commerce_menu_category_check;

create function campusbite_private.check_item_category() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.commerce_stalls where slug=new.stall_slug and new.category=any(menu_categories) for share;
  if not found then raise exception 'Choose a category belonging to this storefront'; end if;
  return new;
end $$;
create trigger check_item_category before insert or update of category,stall_slug on public.commerce_menu
  for each row execute function campusbite_private.check_item_category();

create function public.vendor_save_category(target_shop uuid, previous_name text, new_name text) returns void
language plpgsql security definer set search_path='' as $$
declare
  s public.commerce_stalls;
  label text := btrim(new_name);
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager']) then raise insufficient_privilege; end if;
  if label is null or length(label) not between 1 and 60 or lower(label)='all' then raise exception 'Choose a category name of 1–60 characters other than All'; end if;
  select * into strict s from public.commerce_stalls where shop_id=target_shop for update;
  if previous_name<>'' and not previous_name=any(s.menu_categories) then raise exception 'Category changed. Reload the menu'; end if;
  if exists(select from unnest(s.menu_categories) n where lower(n)=lower(label) and n<>previous_name) then raise exception 'That category already exists'; end if;
  if previous_name='' then
    update public.commerce_stalls set menu_categories=array_append(menu_categories,label) where shop_id=target_shop;
  else
    update public.commerce_stalls set menu_categories=array_replace(menu_categories,previous_name,label) where shop_id=target_shop;
    update public.commerce_menu set category=label where stall_slug=s.slug and category=previous_name;
  end if;
end $$;

create function public.vendor_set_schedule(target_shop uuid, expected_revision integer, opening time, closing time,
  slots integer, basket integer, paused boolean, closures date[], weekly jsonb, minutes integer) returns void
language plpgsql security definer set search_path='' as $$
declare
  day record;
  time_format constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  -- The existing operation checks shop management access and the revision, and locks the storefront.
  perform public.vendor_set_availability(target_shop,expected_revision,opening,closing,slots,basket,paused,closures);
  if jsonb_typeof(weekly) is distinct from 'object' then raise exception 'Invalid weekly schedule'; end if;
  for day in select * from jsonb_each(weekly) loop
    if day.key not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') then raise exception 'Unknown weekday'; end if;
    if day.value <> 'null'::jsonb and (jsonb_typeof(day.value)<>'object' or
       coalesce(day.value->>'opens','') !~ time_format or coalesce(day.value->>'closes','') !~ time_format or
       day.value->>'opens' >= day.value->>'closes') then raise exception 'Check weekday opening and closing times'; end if;
  end loop;
  update public.commerce_stalls set weekly_hours=weekly, pickup_minutes=minutes where shop_id=target_shop;
end $$;

create or replace function campusbite_private.check_vendor_window() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  s public.commerce_stalls;
  pickup timestamp := new.pickup_at at time zone 'Asia/Kolkata';
  day_key text := (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[extract(isodow from pickup)::int];
  opening time;
  closing time;
  units integer;
  prep integer;
begin
  select * into strict s from public.commerce_stalls where shop_id=new.shop_id for share;
  if s.weekly_hours ? day_key then
    opening := (s.weekly_hours->day_key->>'opens')::time;
    closing := (s.weekly_hours->day_key->>'closes')::time;
  else
    opening := s.opens;
    closing := s.closes;
  end if;
  if not s.enabled or s.vendor_paused or pickup::date=any(s.closed_dates) or
     opening is null or closing is null or pickup < pickup::date+opening or
     pickup+make_interval(mins => s.pickup_minutes) > pickup::date+closing then
    raise exception 'This shop is closed for the selected pickup window';
  end if;
  if mod(extract(epoch from pickup-(pickup::date+opening)), s.pickup_minutes*60) <> 0 or
     coalesce((new.detail->>'pickup_minutes')::integer,10) <> s.pickup_minutes then
    raise exception 'Pickup window changed. Choose a new window';
  end if;
  new.pickup_minutes := s.pickup_minutes;
  select sum(i.qty), greatest(4,max(m.prep)) into units,prep
    from jsonb_to_recordset(new.detail->'items') i(id text,qty integer)
    join public.commerce_menu m on m.id=i.id and m.stall_slug=s.slug;
  if units>s.basket_limit then raise exception 'This basket exceeds the shop limit'; end if;
  new.detail := new.detail || jsonb_build_object('prep_minutes',prep+greatest(0,units-1)*2);
  return new;
end $$;

-- Use the configured grid at insert time and include overlapping older reservations
-- when the shop changes window duration or opening time during service.
create or replace function public.commerce_reserve(
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
    or slot > clock_timestamp() + interval '60 minutes' then
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
  if (select count(*) from public.commerce_orders where shop_id = config.shop_id and pickup_at < slot + make_interval(mins => config.pickup_minutes)
      and pickup_at > slot - interval '60 minutes'
      and pickup_at + make_interval(mins => pickup_minutes) > slot
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
    'prep_minutes',coalesce((c.detail->>'prep_minutes')::integer,estimate.minutes),
    'rejection_reason',c.detail->>'rejection_reason','amount_paise',c.amount_paise,'refund',c.refund,
    'events',case when selected_order is not null then coalesce(c.events,'[]'::jsonb) else '[]'::jsonb end)
    order by v.pickup_at,v.id),'[]'::jsonb)
  from visible v left join public.commerce_orders c on c.id=v.id and c.shop_id=v.shop_id
  left join lateral (select case when count(i.qty)>0 then greatest(4,max(m.prep))+2*greatest(0,sum(i.qty)-1) end as minutes
    from jsonb_to_recordset(v.items) i(id text,qty integer) left join public.commerce_menu m on m.id=i.id) estimate
    on c.detail->>'prep_minutes' is null);
end $$;

revoke all on function public.vendor_save_category(uuid,text,text),
  public.vendor_set_schedule(uuid,integer,time,time,integer,integer,boolean,date[],jsonb,integer) from public,anon,authenticated;
grant execute on function public.vendor_save_category(uuid,text,text),
  public.vendor_set_schedule(uuid,integer,time,time,integer,integer,boolean,date[],jsonb,integer) to authenticated;
commit;
