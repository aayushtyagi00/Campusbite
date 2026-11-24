begin;
-- Enrolling a verified authenticator activates second-factor enforcement at the
-- database boundary. The owner can require enrollment for every invited admin.
create table campusbite_private.admin_security(singleton boolean primary key check(singleton),require_mfa boolean not null);
insert into campusbite_private.admin_security values(true,false);
revoke all on campusbite_private.admin_security from public,anon,authenticated,service_role;
create or replace function campusbite_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_admins where email=campusbite_private.verified_email())
    and (coalesce(auth.jwt()->>'aal','aal1')='aal2' or (
      not (select require_mfa from campusbite_private.admin_security where singleton)
      and not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
    ))
$$;
commit;
