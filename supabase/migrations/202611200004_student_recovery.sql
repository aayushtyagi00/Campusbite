begin;

create table campusbite_private.student_recoveries (
  id uuid primary key default gen_random_uuid(),
  email_key text not null,
  requested_at timestamptz not null default clock_timestamp(),
  active boolean not null default true,
  checks integer not null default 0,
  verification uuid,
  lease_until timestamptz,
  grant_key text,
  sealed_access text,
  verified_at timestamptz
);
create index student_recovery_email_time on campusbite_private.student_recoveries(email_key,requested_at desc);
create index student_recovery_expiry on campusbite_private.student_recoveries(requested_at);
create table campusbite_private.student_recovery_traffic (
  ip_key text not null,
  seen_at timestamptz not null default clock_timestamp()
);
create index student_recovery_ip_time on campusbite_private.student_recovery_traffic(ip_key,seen_at);
create index student_recovery_traffic_expiry on campusbite_private.student_recovery_traffic(seen_at);
revoke all on campusbite_private.student_recoveries, campusbite_private.student_recovery_traffic from public,anon,authenticated;

create function public.student_request_recovery(email_hash text, ip_hash text, challenge_passed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  moment timestamptz;
  first_send timestamptz;
  last_send timestamptz;
  sends integer;
  traffic integer;
  retry_at timestamptz;
  attempt uuid;
begin
  if email_hash is null or email_hash !~ '^[0-9a-f]{64}$' or ip_hash is null or ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid recovery request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recovery-ip:'||ip_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('recovery-email:'||email_hash,0));
  moment := clock_timestamp();
  delete from campusbite_private.student_recoveries where requested_at<=moment-interval '1 hour';
  delete from campusbite_private.student_recovery_traffic where seen_at<=moment-interval '1 hour';
  select count(*) into traffic from campusbite_private.student_recovery_traffic where ip_key=ip_hash;
  if traffic>=19 and challenge_passed is not true then return jsonb_build_object('challenge',true); end if;
  insert into campusbite_private.student_recovery_traffic(ip_key,seen_at) values(ip_hash,moment);
  select min(requested_at),max(requested_at),count(*) into first_send,last_send,sends
    from campusbite_private.student_recoveries where email_key=email_hash;
  retry_at := last_send + interval '60 seconds';
  if sends>=5 then retry_at := greatest(retry_at,first_send+interval '1 hour'); end if;
  if retry_at>moment then return jsonb_build_object('wait',ceil(extract(epoch from retry_at-moment))); end if;
  update campusbite_private.student_recoveries set active=false where email_key=email_hash and active;
  insert into campusbite_private.student_recoveries(email_key,requested_at) values(email_hash,moment) returning id into attempt;
  return jsonb_build_object('attempt',attempt,'wait',60);
end $$;

-- Reserve one verification before calling Auth. Concurrent submissions cannot
-- run past the fifth check. A crashed verifier loses its lease after 30 seconds.
create function public.student_check_recovery(attempt uuid, email_hash text, lease uuid)
returns text language plpgsql security definer set search_path='' as $$
declare r campusbite_private.student_recoveries;
begin
  select * into r from campusbite_private.student_recoveries where id=attempt for update;
  if not found or not r.active or r.verified_at is not null or r.requested_at<=clock_timestamp()-interval '1 hour'
    or (email_hash is not null and email_hash<>r.email_key) then return 'expired'; end if;
  if r.lease_until>clock_timestamp() then return 'busy'; end if;
  if r.checks>=5 then return 'locked'; end if;
  update campusbite_private.student_recoveries set checks=checks+1,verification=lease,lease_until=clock_timestamp()+interval '30 seconds'
    where id=attempt;
  return 'ok';
end $$;

create function public.student_finish_check(attempt uuid, lease uuid, verified_email_hash text, proof_hash text, sealed_token text, transient boolean)
returns text language plpgsql security definer set search_path='' as $$
declare r campusbite_private.student_recoveries;
begin
  select * into r from campusbite_private.student_recoveries where id=attempt for update;
  if not found or not r.active or r.verification is distinct from lease or lease is null then return 'expired'; end if;
  if verified_email_hash=r.email_key and proof_hash ~ '^[0-9a-f]{64}$' and sealed_token is not null then
    update campusbite_private.student_recoveries set verification=null,lease_until=null,verified_at=clock_timestamp(),
      grant_key=proof_hash,sealed_access=sealed_token where id=attempt;
    return 'verified';
  end if;
  update campusbite_private.student_recoveries set verification=null,lease_until=null,
    checks=checks-case when transient then 1 else 0 end where id=attempt;
  if r.checks>=5 and not transient then return 'locked'; end if;
  return 'invalid';
end $$;

create function public.student_consume_recovery(attempt uuid, proof_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare token text;
begin
  select sealed_access into token from campusbite_private.student_recoveries where id=attempt and active
    and verified_at>clock_timestamp()-interval '10 minutes' and grant_key=proof_hash for update;
  if found then
    update campusbite_private.student_recoveries set active=false,grant_key=null,sealed_access=null where id=attempt;
  end if;
  return token;
end $$;
revoke all on function public.student_request_recovery(text,text,boolean), public.student_check_recovery(uuid,text,uuid),
  public.student_finish_check(uuid,uuid,text,text,text,boolean), public.student_consume_recovery(uuid,text) from public,anon,authenticated;
grant execute on function public.student_request_recovery(text,text,boolean), public.student_check_recovery(uuid,text,uuid),
  public.student_finish_check(uuid,uuid,text,text,text,boolean), public.student_consume_recovery(uuid,text) to service_role;
commit;
