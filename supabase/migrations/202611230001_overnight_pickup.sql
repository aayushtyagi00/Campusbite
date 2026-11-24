begin;

create or replace function public.review_vendor_application(application_id uuid, expected_revision integer, decision text, note text, existing_shop uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  a public.vendor_applications;
  target uuid;
begin
  if not campusbite_private.is_admin() then raise exception 'Administrator access required'; end if;
  select * into a from public.vendor_applications where id=application_id for update;
  if not found or a.revision <> expected_revision then raise exception 'Application changed. Reload before continuing'; end if;
  if not ((a.status='submitted' and decision='under_review') or
      (a.status='under_review' and decision in ('changes_requested','approved','rejected'))) then
    raise exception 'This review action is unavailable';
  end if;
  if length(note)>1000 or (decision in ('changes_requested','rejected') and btrim(note)='') then
    raise exception 'Enter a review reason of up to 1000 characters';
  end if;
  if decision='approved' then
    if a.applicant_id is null or a.verified_at is null or a.agreed_at is null or a.agreement_version is distinct from 'pilot-v1'
        or a.opens is null or a.closes is null or a.opens = a.closes or a.court='' or a.cuisine='' or a.registration='' then
      raise exception 'Request corrections for the missing onboarding details';
    end if;
    if existing_shop is null then
      insert into public.vendor_shops(name) values (a.shop_name) returning id into target;
    else
      select id into strict target from public.vendor_shops where id=existing_shop for update;
      if exists(select 1 from public.vendor_applications where shop_id=target) then raise exception 'Shop already has an approved application'; end if;
      if exists(select 1 from public.commerce_stalls where shop_id=target and standing='suspended') then raise exception 'Review the suspension before assigning this shop'; end if;
    end if;
    insert into public.vendor_access(shop_id,email,role) values(target,a.email,'owner')
      on conflict(shop_id,email) do update set role='owner';
  end if;
  update public.vendor_applications set status=decision, review_note=btrim(note), revision=revision+1,
    shop_id=coalesce(target,shop_id) where id=a.id;
end $$;

create or replace function public.save_vendor_storefront(target_shop uuid, expected_revision integer, details jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  current_row public.commerce_stalls;
  slug_value text := details->>'slug';
  display_value text := btrim(details->>'display_name');
  payment text := details->>'payment_status';
  standing_value text := details->>'standing';
  published_value boolean := (details->>'published')::boolean;
  enabled_value boolean := (details->>'enabled')::boolean;
  opens_value time := (details->>'opens')::time;
  closes_value time := (details->>'closes')::time;
  saved_revision integer;
begin
  if not campusbite_private.is_admin() then raise exception 'Administrator access required'; end if;
  perform 1 from public.vendor_shops where id=target_shop for update;
  if not found then raise exception 'Shop unavailable'; end if;
  select * into current_row from public.commerce_stalls where shop_id=target_shop for update;
  if coalesce(current_row.revision,-1) <> expected_revision then raise exception 'Shop changed. Reload before continuing'; end if;
  if current_row.slug is not null and current_row.slug <> slug_value then raise exception 'Existing storefront URL must be preserved'; end if;
  if slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(slug_value)>80 or length(display_value) not between 2 and 100
    or details->>'court' not in ('unimall','block-2-cc','block-41','boys-hostel-5-6')
    or length(btrim(details->>'location')) not between 2 and 150 or length(btrim(details->>'cuisine')) not between 2 and 120
    or opens_value = closes_value or opens_value is null or closes_value is null then raise exception 'Check storefront details and hours'; end if;
  if payment='legacy_enabled' and current_row.payment_status is distinct from 'legacy_enabled' then raise exception 'Verify payment onboarding'; end if;
  if payment='verified' and nullif(btrim(details->>'provider_ref'),'') is null then raise exception 'Enter the verified provider account reference'; end if;
  if standing_value='suspended' then published_value:=false; enabled_value:=false; end if;
  if enabled_value and (not published_value or payment not in ('verified','legacy_enabled') or
      not exists(select 1 from public.commerce_menu where stall_slug=slug_value)) then
    raise exception 'Publish the listing, configure its menu and verify payment onboarding before enabling checkout';
  end if;
  insert into public.commerce_stalls as s(slug,shop_id,display_name,court,location,cuisine,opens,closes,capacity,
      payment_status,provider_ref,standing,published,enabled,revision)
    values(slug_value,target_shop,display_value,details->>'court',btrim(details->>'location'),btrim(details->>'cuisine'),
      opens_value,closes_value,(details->>'capacity')::int,payment,btrim(details->>'provider_ref'),standing_value,
      published_value,enabled_value,1)
    on conflict(slug) do update set shop_id=excluded.shop_id,display_name=excluded.display_name,court=excluded.court,
      location=excluded.location,cuisine=excluded.cuisine,opens=excluded.opens,closes=excluded.closes,capacity=excluded.capacity,
      payment_status=excluded.payment_status,provider_ref=excluded.provider_ref,standing=excluded.standing,
      published=excluded.published,enabled=excluded.enabled,revision=s.revision+1
    where s.shop_id is null or s.shop_id=target_shop returning revision into saved_revision;
  if saved_revision is null then raise exception 'Storefront URL already belongs to another shop'; end if;
  update public.vendor_applications set status=standing_value,revision=revision+1
    where shop_id=target_shop and status <> standing_value and status in ('approved','suspended');
end $$;

create or replace function public.vendor_set_availability(target_shop uuid, expected_revision integer, opening time, closing time,
  slots integer, basket integer, paused boolean, closures date[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not campusbite_private.has_shop_role(target_shop,array['owner','manager']) then raise exception 'Shop management access required'; end if;
  if opening is null or closing is null or opening=closing or cardinality(closures)>90 then raise exception 'Check opening hours and closure dates'; end if;
  update public.commerce_stalls set opens=opening, closes=closing, capacity=slots, basket_limit=basket,
    vendor_paused=paused, closed_dates=closures, revision=revision+1 where shop_id=target_shop and revision=expected_revision;
  if not found then raise exception 'Shop settings changed. Reload before saving'; end if;
end $$;

create or replace function public.vendor_set_schedule(target_shop uuid, expected_revision integer, opening time, closing time,
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
       day.value->>'opens' = day.value->>'closes') then raise exception 'Check weekday opening and closing times'; end if;
  end loop;
  update public.commerce_stalls set weekly_hours=weekly, pickup_minutes=minutes where shop_id=target_shop;
end $$;

-- A service day can finish the following morning. Closure dates block any
-- window touching that civil date, including the tail of the previous shift.
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
    and t>=d+opening and t+make_interval(mins=>minutes)<=d+(closing<opening)::integer+closing
    and mod(extract(epoch from t-(d+opening)),minutes*60)=0)
$$;

create or replace function campusbite_private.check_vendor_window() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  s public.commerce_stalls;
  units integer;
  prep integer;
begin
  select * into strict s from public.commerce_stalls where shop_id=new.shop_id for share;
  if not campusbite_private.pickup_fits(s,new.pickup_at,coalesce((new.detail->>'pickup_minutes')::integer,10)) then
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

commit;
