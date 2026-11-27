-- Legacy staff-schema bootstrap. New installations should apply the files in
-- supabase/migrations in filename order. Portal access activates with the
-- vendor-session and owner-admin migrations.
begin;

create schema campusbite_private;
revoke all on schema campusbite_private from public, anon, authenticated;
grant usage on schema campusbite_private to authenticated;

create table public.staff_admins (
  email text primary key check (email = lower(btrim(email)) and length(email) between 3 and 254)
);

create table public.vendor_shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 2 and 100),
  created_at timestamptz not null default now()
);
create unique index vendor_shops_unique_name on public.vendor_shops (lower(name));

create table public.vendor_access (
  shop_id uuid not null references public.vendor_shops(id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (shop_id, email)
);
create index vendor_access_email_idx on public.vendor_access (email);

create table public.vendor_applications (
  id uuid primary key default gen_random_uuid(),
  shop_name text not null check (length(btrim(shop_name)) between 2 and 100),
  contact_name text not null check (length(btrim(contact_name)) between 2 and 100),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  phone text not null check (length(phone) between 7 and 24),
  location text not null check (length(btrim(location)) between 2 and 150),
  description text not null default '' check (length(description) <= 1200),
  status text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  created_at timestamptz not null default now()
);
create index vendor_applications_inbox_idx on public.vendor_applications (created_at desc);

-- Integration tables remain empty until a trusted checkout or finance backend writes records.
create table public.vendor_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.vendor_shops(id) on delete restrict,
  reference text not null check (length(reference) between 1 and 80),
  status text not null check (status in ('awaiting', 'accepted', 'preparing', 'ready', 'collected', 'cancelled')),
  pickup_at timestamptz not null,
  unique (shop_id, reference)
);
create index vendor_orders_shop_pickup_idx on public.vendor_orders (shop_id, pickup_at desc);

create table public.vendor_sales (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.vendor_shops(id) on delete restrict,
  reference text not null check (length(reference) between 1 and 100),
  amount_paise integer not null check (amount_paise <> 0),
  recorded_at timestamptz not null default now(),
  unique (shop_id, reference)
);
create index vendor_sales_shop_date_idx on public.vendor_sales (shop_id, recorded_at desc);

create table public.vendor_access_audit (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.vendor_shops(id) on delete restrict,
  email text not null,
  actor_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_role text,
  new_role text,
  created_at timestamptz not null default now()
);

create table campusbite_private.staff_rate_limits (
  bucket text not null,
  key_hash text not null,
  hits integer not null,
  expires_at timestamptz not null,
  primary key (bucket, key_hash)
);
create index staff_rate_limits_expiry_idx on campusbite_private.staff_rate_limits (expires_at);

alter table public.staff_admins enable row level security;
alter table public.vendor_shops enable row level security;
alter table public.vendor_access enable row level security;
alter table public.vendor_applications enable row level security;
alter table public.vendor_orders enable row level security;
alter table public.vendor_sales enable row level security;
alter table public.vendor_access_audit enable row level security;
alter table campusbite_private.staff_rate_limits enable row level security;

revoke all on public.staff_admins, public.vendor_shops, public.vendor_access, public.vendor_applications,
  public.vendor_orders, public.vendor_sales, public.vendor_access_audit from public, anon, authenticated;
grant select on public.vendor_shops, public.vendor_access, public.vendor_applications,
  public.vendor_orders, public.vendor_sales, public.vendor_access_audit to authenticated;
grant insert on public.vendor_shops, public.vendor_access to authenticated;
grant update (role) on public.vendor_access to authenticated;
grant delete on public.vendor_access to authenticated;
grant update (status) on public.vendor_applications to authenticated;
grant select on public.staff_admins, public.vendor_access to service_role;
grant insert on public.vendor_applications, public.vendor_orders, public.vendor_sales to service_role;

create function campusbite_private.verified_email()
returns text
language sql stable security definer set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null
$$;

create function campusbite_private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select false $$;

create function campusbite_private.has_shop_role(p_shop_id uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = ''
as $$ select false $$;

revoke all on function campusbite_private.verified_email(), campusbite_private.is_admin(),
  campusbite_private.has_shop_role(uuid, text[]) from public, anon, authenticated;
grant execute on function campusbite_private.verified_email(), campusbite_private.is_admin(),
  campusbite_private.has_shop_role(uuid, text[]) to authenticated;

create function public.campusbite_is_admin()
returns boolean
language sql stable set search_path = ''
as $$ select campusbite_private.is_admin() $$;
revoke all on function public.campusbite_is_admin() from public, anon, authenticated;
grant execute on function public.campusbite_is_admin() to authenticated;

create policy shops_read on public.vendor_shops for select to authenticated using (
  (select campusbite_private.is_admin()) or campusbite_private.has_shop_role(id, array['owner', 'manager', 'staff'])
);
create policy shops_admin_insert on public.vendor_shops for insert to authenticated with check ((select campusbite_private.is_admin()));

create policy access_read on public.vendor_access for select to authenticated using (
  (select campusbite_private.is_admin())
);
create policy access_admin_insert on public.vendor_access for insert to authenticated with check ((select campusbite_private.is_admin()));
create policy access_admin_update on public.vendor_access for update to authenticated
  using ((select campusbite_private.is_admin())) with check ((select campusbite_private.is_admin()));
create policy access_admin_delete on public.vendor_access for delete to authenticated using ((select campusbite_private.is_admin()));

create policy applications_admin_read on public.vendor_applications for select to authenticated using ((select campusbite_private.is_admin()));
create policy applications_admin_review on public.vendor_applications for update to authenticated
  using ((select campusbite_private.is_admin())) with check ((select campusbite_private.is_admin()));

create policy orders_shop_read on public.vendor_orders for select to authenticated using (
  (select campusbite_private.is_admin()) or campusbite_private.has_shop_role(shop_id, array['owner', 'manager', 'staff'])
);
create policy sales_shop_read on public.vendor_sales for select to authenticated using (
  (select campusbite_private.is_admin()) or campusbite_private.has_shop_role(shop_id, array['owner', 'manager'])
);
create policy audit_admin_read on public.vendor_access_audit for select to authenticated using ((select campusbite_private.is_admin()));

create function public.campusbite_grant_vendor_access(p_shop_id uuid, p_email text, p_role text)
returns void
language sql set search_path = ''
as $$
  insert into public.vendor_access (shop_id, email, role) values (p_shop_id, p_email, p_role)
  on conflict (shop_id, email) do update set role = excluded.role
$$;
revoke all on function public.campusbite_grant_vendor_access(uuid, text, text) from public, anon, authenticated;
grant execute on function public.campusbite_grant_vendor_access(uuid, text, text) to authenticated;

create function campusbite_private.log_vendor_access()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.role = new.role then return new; end if;
  insert into public.vendor_access_audit (shop_id, email, actor_id, action, old_role, new_role)
  values (
    case when tg_op = 'DELETE' then old.shop_id else new.shop_id end,
    case when tg_op = 'DELETE' then old.email else new.email end,
    auth.uid(), tg_op,
    case when tg_op <> 'INSERT' then old.role end,
    case when tg_op <> 'DELETE' then new.role end
  );
  return null;
end;
$$;
revoke all on function campusbite_private.log_vendor_access() from public, anon, authenticated;
create trigger vendor_access_audited after insert or update or delete on public.vendor_access
for each row execute function campusbite_private.log_vendor_access();

create function public.campusbite_consume_attempt(p_bucket text, p_key_hash text, p_limit integer, p_seconds integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  touched integer;
  current_timepoint timestamptz := statement_timestamp();
begin
  insert into campusbite_private.staff_rate_limits as rate (bucket, key_hash, hits, expires_at)
  values (p_bucket, p_key_hash, 1, current_timepoint + make_interval(secs => p_seconds))
  on conflict (bucket, key_hash) do update set
    hits = case when rate.expires_at <= current_timepoint then 1 else rate.hits + 1 end,
    expires_at = case when rate.expires_at <= current_timepoint then excluded.expires_at else rate.expires_at end
  where rate.expires_at <= current_timepoint or rate.hits < p_limit;
  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;
revoke all on function public.campusbite_consume_attempt(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.campusbite_consume_attempt(text, text, integer, integer) to service_role;

-- Enable this Auth hook on the staff-only Supabase project.
create function public.campusbite_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  requested_email text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if exists (select 1 from public.staff_admins where email = requested_email)
    or exists (select 1 from public.vendor_access where email = requested_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Staff registration is by invitation only.'));
end;
$$;
revoke all on function public.campusbite_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.campusbite_before_user_created(jsonb) to supabase_auth_admin;

alter table public.staff_admins
  add constraint campusbite_sole_admin check (email = 'tyagiaayush3030@gmail.com');
insert into public.staff_admins(email) values ('tyagiaayush3030@gmail.com');
commit;

select email as authorized_admin from public.staff_admins;
