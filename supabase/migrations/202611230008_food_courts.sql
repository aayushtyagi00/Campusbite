begin;
create table public.food_courts (id text primary key check(id ~ '^[a-z0-9-]{1,80}$'),name text not null check(length(trim(name)) between 1 and 100),position integer not null default 100);
insert into public.food_courts values ('unimall','UniMall',1),('block-2-cc','Near Block 2 - CC',2),('block-41','Near Block 41',3),('boys-hostel-5-6','Near Boys'' Hostel 5-6',4);
alter table public.food_courts enable row level security;
revoke all on public.food_courts from public,anon,authenticated;
grant select on public.food_courts to service_role,authenticated,anon;
create policy read_food_courts on public.food_courts for select using(true);
grant insert,update on public.food_courts to authenticated;
create policy manage_food_courts on public.food_courts for all to authenticated using(campusbite_private.is_admin()) with check(campusbite_private.is_admin());
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
    or not exists(select 1 from public.food_courts c where c.id=details->>'court')
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
commit;
