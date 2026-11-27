begin;

create function campusbite_private.owner_email() returns text
language sql immutable set search_path='' as $$ select 'tyagiaayush3030@gmail.com'::text $$;
revoke all on function campusbite_private.owner_email() from public,anon,authenticated,service_role;
insert into public.staff_admins(email) values (campusbite_private.owner_email()) on conflict do nothing;
update campusbite_private.admin_security set require_mfa=true where singleton;

create table campusbite_private.admin_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null,
  google_subject text not null
);
alter table campusbite_private.admin_sessions enable row level security;
revoke all on campusbite_private.admin_sessions from public,anon,authenticated,service_role;

create function campusbite_private.owner_identity(login_user uuid, google_subject text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from auth.users u join auth.identities i on i.user_id=u.id
      join public.staff_admins a on a.email=lower(u.email)
    where u.id=login_user and a.email=campusbite_private.owner_email() and u.email_confirmed_at is not null
      and i.provider='google' and i.provider_id=google_subject
      and lower(i.identity_data->>'email')=a.email and i.identity_data->>'email_verified'='true'
  )
$$;
revoke all on function campusbite_private.owner_identity(uuid,text) from public,anon,authenticated,service_role;

-- The server registers only a completed admin OAuth exchange, after obtaining
-- the Google subject from userinfo with the access token from that exchange.
create function public.register_admin_session(login_session uuid, login_user uuid, google_subject text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  insert into campusbite_private.admin_sessions(session_id,user_id,google_subject)
    select s.id,s.user_id,register_admin_session.google_subject from auth.sessions s
    where s.id=login_session and s.user_id=login_user
      and campusbite_private.owner_identity(login_user,register_admin_session.google_subject)
    on conflict (session_id) do update set google_subject=excluded.google_subject;
  return found;
end $$;
revoke all on function public.register_admin_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.register_admin_session(uuid,uuid,text) to service_role;

create function public.campusbite_owner_state() returns text
language sql stable security definer set search_path='' as $$
  select case
    when not exists (select 1 from campusbite_private.admin_sessions s
      where s.session_id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid()
        and campusbite_private.owner_identity(s.user_id,s.google_subject)) then 'denied'
    when auth.jwt()->>'aal'='aal2' and exists (
      select 1 from jsonb_array_elements(auth.jwt()->'amr') m where m->>'method' in ('totp','mfa/totp')
    ) and exists (select 1 from auth.mfa_factors f
      where f.user_id=auth.uid() and f.factor_type='totp' and f.status='verified') then 'granted'
    else 'challenge' end
$$;
revoke all on function public.campusbite_owner_state() from public,anon,authenticated,service_role;
grant execute on function public.campusbite_owner_state() to authenticated;

create function public.end_staff_session() returns void
language plpgsql security definer set search_path='' as $$
declare current_session_id uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  delete from campusbite_private.admin_sessions where session_id=current_session_id and user_id=auth.uid();
  delete from campusbite_private.vendor_sessions where session_id=current_session_id and user_id=auth.uid();
end $$;
revoke all on function public.end_staff_session() from public,anon,authenticated,service_role;
grant execute on function public.end_staff_session() to authenticated;

create or replace function campusbite_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select public.campusbite_owner_state()='granted'
$$;

create or replace function public.campusbite_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare requested_email text := lower(btrim(event->'user'->>'email'));
begin
  if (requested_email=campusbite_private.owner_email()
      and exists(select 1 from public.staff_admins where email=requested_email))
    or exists(select 1 from public.vendor_access where email=requested_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Staff registration is by invitation only.'));
end $$;

-- An existing push endpoint must be re-enabled in a verified staff session.
alter table public.push_subscriptions add column staff_session_id uuid references auth.sessions(id) on delete set null;
create or replace function public.claim_order_push() returns table(id bigint,lease uuid,endpoint text,keys jsonb,body text,audience text)
language sql security definer set search_path='' as $$
  with claimed as (
    update campusbite_private.push_jobs j set lease=gen_random_uuid(),attempts=j.attempts+1,due=now()+interval '2 minutes'
    where j.id in(select q.id from campusbite_private.push_jobs q where q.finished_at is null and q.attempts<8 and q.due<=now()
      order by q.due limit 40 for update skip locked) returning j.*
  ) select j.id,j.lease,s.endpoint,s.keys,j.body,s.audience from claimed j join public.push_subscriptions s using(endpoint)
    join public.commerce_orders o on o.id=j.order_id
    where (s.audience='student' and j.topic in ('order','refund') and s.student_id=o.student_id
      and (case when j.topic='refund' then s.refund_alerts else s.order_alerts end))
    or (s.audience='vendor' and j.topic in ('new','deadline') and o.status='awaiting' and o.accept_until>now() and s.shop_id=o.shop_id
      and exists(select 1 from campusbite_private.vendor_sessions v join auth.users u on u.id=v.user_id
        join public.vendor_access a on a.email=v.email and a.shop_id=s.shop_id
        where v.session_id=s.staff_session_id and v.email=s.email and lower(u.email)=v.email and u.email_confirmed_at is not null))
    or (s.audience='admin' and j.topic='exception' and s.email=campusbite_private.owner_email()
      and exists(select 1 from campusbite_private.admin_sessions a where a.session_id=s.staff_session_id
        and campusbite_private.owner_identity(a.user_id,a.google_subject)
        and exists(select 1 from auth.mfa_factors f where f.user_id=a.user_id and f.factor_type='totp' and f.status='verified')))
$$;
commit;
