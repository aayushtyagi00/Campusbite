begin;
alter table public.commerce_orders
  add column support_state text not null default 'open' check (support_state in ('open','investigating','resolved')),
  add column support_owner text,
  add column support_reply text,
  add column support_revision integer not null default 0,
  add column refund_requested_at timestamptz,
  add column collected_by uuid,
  add column collected_at timestamptz;

update public.commerce_orders set refund_requested_at=now() where refund in ('Requested','Pending');
create function campusbite_private.record_refund_request_time() returns trigger language plpgsql set search_path='' as $$
begin
  if old.refund='None' and new.refund='Requested' then new.refund_requested_at:=clock_timestamp(); end if;
  return new;
end $$;
create trigger record_refund_request_time before update of refund on public.commerce_orders for each row execute function campusbite_private.record_refund_request_time();

create function public.review_order_case(target uuid, version integer, state text, reply text, request_refund boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare purchase public.commerce_orders; operator text;
begin
  if not campusbite_private.is_admin() then raise insufficient_privilege; end if;
  select email into strict operator from auth.users where id=auth.uid();
  select * into purchase from public.commerce_orders where id=target for update;
  if not found or purchase.support_revision<>version then return false; end if;
  if state not in ('open','investigating','resolved') or nullif(trim(reply),'') is null or length(reply)>1000 then return false; end if;
  if request_refund then
    if purchase.provider_payment is null or purchase.refund<>'None' then return false; end if;
    if purchase.status in ('awaiting','accepted','preparing','ready') then
      perform campusbite_private.commerce_set_status(target,'cancelled');
    end if;
    update public.commerce_orders set refund='Requested',refund_after=now() where id=target;
  end if;
  update public.commerce_orders set support_state=state,support_reply=trim(reply),support_owner=operator,
    support_revision=version+1,events=events||jsonb_build_array(jsonb_build_object('status','Support · '||state,'at',extract(epoch from now())*1000))
    where id=target;
  return true;
end $$;
revoke all on function public.review_order_case(uuid,integer,text,text,boolean) from public,anon;
grant execute on function public.review_order_case(uuid,integer,text,text,boolean) to authenticated;

create table public.ordering_control(singleton boolean primary key default true check(singleton),
  paused boolean not null default false, changed_by uuid, changed_at timestamptz);
insert into public.ordering_control(singleton) values(true);
alter table public.ordering_control enable row level security;
revoke all on public.ordering_control from public,anon,authenticated;
grant select on public.ordering_control to service_role,authenticated;
create policy admin_ordering_control on public.ordering_control for select to authenticated using(campusbite_private.is_admin());
create function public.set_ordering_pause(value boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if not campusbite_private.is_admin() then raise insufficient_privilege; end if;
  update public.ordering_control set paused=value,changed_by=auth.uid(),changed_at=now() where singleton;
end $$;
revoke all on function public.set_ordering_pause(boolean) from public,anon;
grant execute on function public.set_ordering_pause(boolean) to authenticated;
create function campusbite_private.guard_order_operations() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if (select paused from public.ordering_control where singleton for share) then raise exception 'Campus ordering is paused'; end if;
  elsif new.status='collected' and old.status='ready' then
    new.collected_by:=auth.uid();
    new.collected_at:=clock_timestamp();
  end if;
  return new;
end $$;
create trigger guard_order_operations before insert or update of status on public.commerce_orders
  for each row execute function campusbite_private.guard_order_operations();
commit;
