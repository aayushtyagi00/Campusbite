begin;

-- Only a completed vendor login registers a session. Supabase removes the
-- marker when the provider session is deleted, including on sign-out.
create table campusbite_private.vendor_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null,
  email text not null
);
alter table campusbite_private.vendor_sessions enable row level security;
revoke all on campusbite_private.vendor_sessions from public, anon, authenticated, service_role;

-- Existing Auth accounts may have been created while automatic email
-- confirmation was enabled. Record proof of mailbox control from the vendor
-- password setup flow before accepting a password for the vendor portal.
create table campusbite_private.vendor_passwords (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null
);
alter table campusbite_private.vendor_passwords enable row level security;
revoke all on campusbite_private.vendor_passwords from public,anon,authenticated,service_role;

create function public.confirm_vendor_password_setup(login_session uuid, login_user uuid, login_email text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  insert into campusbite_private.vendor_passwords(user_id,email)
    select u.id,lower(u.email) from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=login_session and u.id=login_user and lower(u.email)=login_email and u.email_confirmed_at is not null
      and exists(select 1 from public.vendor_access a where a.email=login_email)
    on conflict(user_id) do update set email=excluded.email;
  return found;
end $$;
revoke all on function public.confirm_vendor_password_setup(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_vendor_password_setup(uuid,uuid,text) to service_role;

create function public.register_vendor_session(login_session uuid, login_user uuid, login_email text, google_subject text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  insert into campusbite_private.vendor_sessions(session_id,user_id,email)
    select s.id, s.user_id, lower(u.email)
    from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=login_session and s.user_id=login_user and lower(u.email)=login_email and u.email_confirmed_at is not null
      and exists(select 1 from public.vendor_access a where a.email=lower(u.email))
      and (case when google_subject is null then exists (
        select 1 from campusbite_private.vendor_passwords p where p.user_id=u.id and p.email=login_email
      ) else exists (
        select 1 from auth.identities i where i.user_id=u.id and i.provider='google' and i.provider_id=google_subject
          and lower(i.identity_data->>'email')=login_email and i.identity_data->>'email_verified'='true'
      ) end)
    on conflict(session_id) do update set email=excluded.email;
  return found;
end $$;
revoke all on function public.register_vendor_session(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_vendor_session(uuid,uuid,text,text) to service_role;

create function campusbite_private.vendor_email() returns text
language sql stable security definer set search_path='' as $$
  select s.email from campusbite_private.vendor_sessions s
    where s.session_id = nullif(auth.jwt()->>'session_id','')::uuid
      and s.user_id=auth.uid() and s.email=campusbite_private.verified_email()
      and exists(select 1 from public.vendor_access a where a.email=s.email)
$$;
revoke all on function campusbite_private.vendor_email() from public,anon,authenticated;
grant execute on function campusbite_private.vendor_email() to authenticated;

create function public.campusbite_vendor_session() returns boolean
language sql stable set search_path='' as $$ select campusbite_private.vendor_email() is not null $$;
revoke all on function public.campusbite_vendor_session() from public,anon,authenticated;
grant execute on function public.campusbite_vendor_session() to authenticated;

create or replace function campusbite_private.has_shop_role(p_shop_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.vendor_access g where g.shop_id=p_shop_id and g.role=any(p_roles)
      and g.email=campusbite_private.vendor_email()
  )
$$;
alter policy access_read on public.vendor_access using (
  (select campusbite_private.is_admin()) or email=(select campusbite_private.vendor_email())
);

commit;
