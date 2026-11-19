begin;

alter table public.vendor_applications
  drop constraint vendor_applications_status_check,
  drop constraint vendor_applications_contact_name_check,
  drop constraint vendor_applications_phone_check,
  drop constraint vendor_applications_location_check,
  add column court text not null default '',
  add column cuisine text not null default '',
  add column opens time,
  add column closes time,
  add column registration text not null default '',
  add column documents jsonb not null default '[]' check (jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) <= 4),
  add column agreement_version text,
  add column agreed_at timestamptz,
  add column verified_at timestamptz,
  add column applicant_id uuid,
  add column review_note text not null default '',
  add column shop_id uuid unique references public.vendor_shops(id),
  add column revision integer not null default 0;
update public.vendor_applications set status = 'under_review' where status = 'reviewed';
alter table public.vendor_applications add check (status in
  ('draft','submitted','under_review','changes_requested','approved','rejected','suspended'));
create index vendor_applications_email on public.vendor_applications(email,created_at desc);
revoke update(status) on public.vendor_applications from authenticated;
grant select, update on public.vendor_applications to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('vendor-onboarding','vendor-onboarding',false,3145728,array['application/pdf']);

alter table public.commerce_stalls
  alter column shop_id drop not null,
  add column display_name text not null default '',
  add column court text not null default 'unimall',
  add column location text not null default '',
  add column cuisine text not null default '',
  add column photo text not null default '',
  add column opens time,
  add column closes time,
  add column standing text not null default 'approved' check (standing in ('approved','suspended')),
  add column payment_status text not null default 'not_started' check (payment_status in ('not_started','pending','verified','legacy_enabled')),
  add column provider_ref text not null default '',
  add column published boolean not null default false,
  add column revision integer not null default 0;
update public.commerce_stalls s set display_name = v.name, published = true,
  payment_status = case when enabled then 'legacy_enabled' else 'not_started' end
  from public.vendor_shops v where v.id = s.shop_id;
-- Keep the pilot URLs, photos and menus, including as-yet unlinked browse-only stalls.
insert into public.commerce_stalls(slug,capacity,display_name,location,cuisine,photo,opens,closes,published)
values ('rolling-kitchen',5,'The Rolling Kitchen','Stall 04 · Level 1, UniMall','Wraps, bowls & rolls','rolling','10:00','20:00',true),
  ('chai-co',5,'Chai & Co','Stall 07 · Central Atrium, UniMall','Fresh chai, bun maska & snacks','chai','09:00','20:00',true),
  ('punjab-plate',5,'Punjab Plate','Stall 02 · North Wing, UniMall','North Indian thalis & quick combos','punjab','10:00','20:00',true)
on conflict(slug) do update set display_name=excluded.display_name, location=excluded.location,
  cuisine=excluded.cuisine, photo=excluded.photo, opens=excluded.opens, closes=excluded.closes;
alter table public.commerce_stalls add check (not enabled or
  (shop_id is not null and published and standing='approved' and payment_status in ('legacy_enabled','verified')));
revoke insert, update on public.commerce_stalls from authenticated;
-- The old all-operations policy also covered inserts once granted. Limit the new
-- onboarding insert privilege to administrators while retaining existing menu edits.
create policy menu_onboarding_insert on public.commerce_menu as restrictive for insert to authenticated
  with check (campusbite_private.is_admin());
grant insert on public.commerce_menu to authenticated;

create function public.review_vendor_application(application_id uuid, expected_revision integer, decision text, note text, existing_shop uuid default null)
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
        or a.opens is null or a.closes is null or a.opens >= a.closes or a.court='' or a.cuisine='' or a.registration='' then
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

-- Serialize edits to one shop. An unlinked pilot listing may be claimed once.
create function public.save_vendor_storefront(target_shop uuid, expected_revision integer, details jsonb)
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
    or opens_value >= closes_value or opens_value is null or closes_value is null then raise exception 'Check storefront details and hours'; end if;
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

revoke all on function public.review_vendor_application(uuid,integer,text,text,uuid),
  public.save_vendor_storefront(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.review_vendor_application(uuid,integer,text,text,uuid),
  public.save_vendor_storefront(uuid,integer,jsonb) to authenticated;
commit;
