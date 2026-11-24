begin;
-- The per-installation secret stays inside the commerce database. Knowing a public
-- order reference is insufficient to derive a handoff code.
create table campusbite_private.pickup_secret(singleton boolean primary key check(singleton),secret uuid not null);
insert into campusbite_private.pickup_secret values(true,gen_random_uuid());
create table campusbite_private.pickup_legacy_offset(order_id uuid primary key references public.commerce_orders,offset_value integer not null);
create table campusbite_private.pickup_operator_limits(operator_id uuid primary key,expires timestamptz not null,failures integer not null);
revoke all on campusbite_private.pickup_secret,campusbite_private.pickup_legacy_offset,campusbite_private.pickup_operator_limits from public,anon,authenticated,service_role;
create function campusbite_private.handoff_code(target uuid) returns text language sql stable security definer set search_path='' as $$
  select lpad(mod(('x'||left(encode(sha256(uuid_send(k.secret)||uuid_send(target)),'hex'),8))::bit(32)::bigint+
    coalesce((select offset_value from campusbite_private.pickup_legacy_offset where order_id=target),0),1000000)::text,6,'0')
  from campusbite_private.pickup_secret k
$$;
revoke all on function campusbite_private.handoff_code(uuid) from public,anon,authenticated,service_role;
-- Keep codes already shown for active pickups usable across the migration.
insert into campusbite_private.pickup_legacy_offset select id,mod(1000000+pickup_code::integer-campusbite_private.handoff_code(id)::integer,1000000)
  from public.commerce_orders where status='ready' and pickup_code ~ '^[0-9]{6}$';
update public.commerce_orders set pickup_code='' where pickup_code<>'';
create function public.student_pickup_codes(actor uuid,targets uuid[]) returns table(id uuid,code text)
language sql stable security definer set search_path='' as $$
  select o.id,campusbite_private.handoff_code(o.id) from public.commerce_orders o
    where o.student_id=actor and o.id=any(targets) and o.status in ('accepted','preparing','ready')
$$;
revoke all on function public.student_pickup_codes(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.student_pickup_codes(uuid,uuid[]) to service_role;
create or replace function campusbite_private.commerce_fulfill(order_id uuid, next_status text, submitted_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  purchase public.commerce_orders;
  expected_code text;
  operator_id uuid := auth.uid();
begin
  select * into purchase from public.commerce_orders where id = order_id
    and campusbite_private.has_shop_role(shop_id, array['owner','manager','staff']);
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('slot:' || purchase.shop_id::text || ':' || extract(epoch from purchase.pickup_at)::text, 0));
  select * into purchase from public.commerce_orders where id = order_id
    and campusbite_private.has_shop_role(shop_id, array['owner','manager','staff']) for update;
  if not found then return false; end if;
  if purchase.status = 'ready' and next_status = 'collected' then
    if purchase.holding_until <= clock_timestamp() then return false; end if;
    perform pg_advisory_xact_lock(hashtextextended('handoff:'||operator_id::text,0));
    if exists(select 1 from campusbite_private.pickup_operator_limits l where l.operator_id=auth.uid()
      and expires>clock_timestamp() and failures>=10) then return false; end if;
    expected_code := campusbite_private.handoff_code(order_id);
    if purchase.pickup_attempts >= 5 and purchase.pickup_retry_after > clock_timestamp() then return false; end if;
    if expected_code <> coalesce(submitted_code,'') then
      insert into campusbite_private.pickup_operator_limits as l values(auth.uid(),clock_timestamp()+interval '5 minutes',1)
        on conflict on constraint pickup_operator_limits_pkey do update set
        failures=case when l.expires>clock_timestamp() then l.failures+1 else 1 end,
        expires=case when l.expires>clock_timestamp() then l.expires else excluded.expires end;
      update public.commerce_orders set
        pickup_attempts = case when pickup_retry_after > clock_timestamp() then pickup_attempts + 1 else 1 end,
        pickup_retry_after = case when pickup_retry_after > clock_timestamp() then pickup_retry_after else clock_timestamp() + interval '5 minutes' end
        where id = purchase.id;
      return false;
    end if;
  end if;
  if not coalesce(
    (purchase.status = 'awaiting' and purchase.accept_until > clock_timestamp() and next_status in ('accepted','rejected'))
    or (purchase.status = 'accepted' and next_status = 'preparing')
    or (purchase.status = 'preparing' and next_status = 'ready')
    or (purchase.status = 'ready' and next_status = 'collected' and expected_code = submitted_code), false
  ) then return false; end if;
  if next_status = 'collected' then
    insert into public.vendor_sales (shop_id, reference, amount_paise)
      values (purchase.shop_id, purchase.id::text, purchase.amount_paise);
  end if;
  perform campusbite_private.commerce_set_status(order_id, next_status);
  return true;
end $$;
commit;
