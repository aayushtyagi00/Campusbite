begin;

alter table public.commerce_stalls
  add column vendor_paused boolean not null default false,
  add column closed_dates date[] not null default '{}',
  add column basket_limit integer not null default 8 check (basket_limit between 1 and 8);
alter table public.commerce_menu
  add column archived boolean not null default false check (not archived or sold_out),
  add column revision integer not null default 0;

create function campusbite_private.menu_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  new.revision := old.revision + 1;
  return new;
end $$;
create trigger commerce_menu_revision before update on public.commerce_menu
  for each row execute function campusbite_private.menu_revision();

-- Keep the existing reservation locks and price checks. Validate shop operating
-- rules inside the same transaction and retain the prep estimate at purchase.
create function campusbite_private.check_vendor_window() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  s public.commerce_stalls;
  pickup timestamp := new.pickup_at at time zone 'Asia/Kolkata';
  units integer;
  prep integer;
begin
  select * into strict s from public.commerce_stalls where shop_id=new.shop_id for share;
  if not s.enabled or s.vendor_paused or pickup::date=any(s.closed_dates) or
     s.opens is null or s.closes is null or pickup < pickup::date+s.opens or
     pickup+interval '10 minutes' > pickup::date+s.closes then
    raise exception 'This shop is closed for the selected pickup window';
  end if;
  select sum(i.qty), greatest(4,max(m.prep)) into units,prep
    from jsonb_to_recordset(new.detail->'items') i(id text,qty integer)
    join public.commerce_menu m on m.id=i.id and m.stall_slug=s.slug;
  if units>s.basket_limit then raise exception 'This basket exceeds the shop limit'; end if;
  new.detail := new.detail || jsonb_build_object('prep_minutes',prep+greatest(0,units-1)*2);
  return new;
end $$;
create trigger check_vendor_window before insert on public.commerce_orders
  for each row execute function campusbite_private.check_vendor_window();

create function public.vendor_set_availability(target_shop uuid, expected_revision integer, opening time, closing time,
  slots integer, basket integer, paused boolean, closures date[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager']) then raise exception 'Shop management access required'; end if;
  if opening is null or closing is null or opening>=closing or cardinality(closures)>90 then raise exception 'Check opening hours and closure dates'; end if;
  update public.commerce_stalls set opens=opening, closes=closing, capacity=slots, basket_limit=basket,
    vendor_paused=paused, closed_dates=closures, revision=revision+1 where shop_id=target_shop and revision=expected_revision;
  if not found then raise exception 'Shop settings changed. Reload before saving'; end if;
end $$;

create function public.vendor_write_item(target_shop uuid, item_id text, expected_revision integer, fields jsonb) returns void
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
    insert into public.commerce_menu(id,stall_slug,name,category,description,price,prep,diet,photo,sold_out,archived)
      values(item_id,stall,name_value,fields->>'category',fields->>'description',(fields->>'price')::int,(fields->>'prep')::int,
        fields->>'diet',fields->>'photo',sold_value,archived_value);
  else
    update public.commerce_menu set name=name_value,category=fields->>'category',description=fields->>'description',
      price=(fields->>'price')::int, prep=(fields->>'prep')::int, diet=fields->>'diet',photo=fields->>'photo',
      sold_out=sold_value,archived=archived_value where id=item_id and stall_slug=stall and revision=expected_revision;
    if not found then raise exception 'Menu item changed. Reload before saving'; end if;
  end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('menu-photos','menu-photos',true,3145728,array['image/jpeg','image/png','image/webp']);

-- All transitions still use the same locked fulfillment function. A rejection
-- records its explanation and schedules the existing refund in one transaction.
alter function public.commerce_fulfill(uuid,text,text) set schema campusbite_private;
revoke all on function campusbite_private.commerce_fulfill(uuid,text,text) from public,anon,authenticated;
create function public.commerce_fulfill(order_id uuid,next_status text,submitted_code text) returns boolean
language sql security definer set search_path='' as $$
  select case when next_status='rejected' then false else campusbite_private.commerce_fulfill(order_id,next_status,submitted_code) end
$$;
create function public.vendor_reject_order(order_id uuid, reason text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if length(btrim(coalesce(reason,''))) not between 1 and 300 then raise exception 'Enter a rejection reason'; end if;
  if not campusbite_private.commerce_fulfill(order_id,'rejected','') then return false; end if;
  update public.commerce_orders set detail=detail || jsonb_build_object('rejection_reason',btrim(reason)) where id=order_id;
  return true;
end $$;

create function public.vendor_order_feed(target_shop uuid, selected_order uuid default null) returns jsonb
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
    'pickup_at',v.pickup_at,'items',v.items,'preparation_note',v.preparation_note,'accept_until',c.accept_until,
    'prep_minutes',coalesce((c.detail->>'prep_minutes')::integer,estimate.minutes),
    'rejection_reason',c.detail->>'rejection_reason','amount_paise',c.amount_paise,'refund',c.refund,
    'events',case when selected_order is not null then coalesce(c.events,'[]'::jsonb) else '[]'::jsonb end)
    order by v.pickup_at,v.id),'[]'::jsonb)
  from visible v left join public.commerce_orders c on c.id=v.id and c.shop_id=v.shop_id
  left join lateral (select case when count(i.qty)>0 then greatest(4,max(m.prep))+2*greatest(0,sum(i.qty)-1) end as minutes
    from jsonb_to_recordset(v.items) i(id text,qty integer) left join public.commerce_menu m on m.id=i.id) estimate
    on c.detail->>'prep_minutes' is null);
end $$;

create function public.vendor_application_summary(target_shop uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager']) then raise insufficient_privilege; end if;
  return (select jsonb_build_object('status',status,'agreed_at',agreed_at,'agreement_version',agreement_version,'document_count',jsonb_array_length(documents))
    from public.vendor_applications where shop_id=target_shop);
end $$;
revoke all on function public.vendor_application_summary(uuid) from public,anon,authenticated;
grant execute on function public.vendor_application_summary(uuid) to authenticated;
create index commerce_vendor_earnings on public.commerce_orders(shop_id,created_at) where provider_payment is not null;

create function public.vendor_earnings(target_shop uuid, since_time timestamptz, until_time timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager']) then raise insufficient_privilege; end if;
  return (select jsonb_build_object('captured',coalesce(sum(amount_paise),0),'orders',count(*),
    'refunded',coalesce(sum(amount_paise) filter(where refund='Succeeded'),0),
    'refund_pending',coalesce(sum(amount_paise) filter(where refund in ('Requested','Pending')),0))
    from public.commerce_orders where shop_id=target_shop and provider_payment is not null and created_at>=since_time and created_at<until_time);
end $$;

do $$ begin
  if exists(select from pg_publication where pubname='supabase_realtime') and
     not exists(select from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='vendor_orders') then
    alter publication supabase_realtime add table public.vendor_orders;
  end if;
end $$;
revoke all on function public.vendor_order_feed(uuid,uuid),public.vendor_earnings(uuid,timestamptz,timestamptz),
  public.vendor_reject_order(uuid,text),public.commerce_fulfill(uuid,text,text),public.vendor_write_item(uuid,text,integer,jsonb),
  public.vendor_set_availability(uuid,integer,time,time,integer,integer,boolean,date[]) from public,anon,authenticated;
grant execute on function public.vendor_order_feed(uuid,uuid),public.vendor_earnings(uuid,timestamptz,timestamptz),
  public.vendor_reject_order(uuid,text),public.commerce_fulfill(uuid,text,text),public.vendor_write_item(uuid,text,integer,jsonb),
  public.vendor_set_availability(uuid,integer,time,time,integer,integer,boolean,date[]) to authenticated;
commit;
