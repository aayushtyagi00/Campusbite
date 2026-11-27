begin;

alter table public.commerce_orders add column refund_failures integer not null default 0;

create function campusbite_private.backoff_refund_failure() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.refund = 'Succeeded' or new.refund_error is null then
    new.refund_failures := 0;
  elsif new.refund in ('Requested','Pending') then
    new.refund_failures := least(old.refund_failures + 1, 9);
    new.refund_after := greatest(new.refund_after, clock_timestamp() +
      make_interval(mins => least(360, 1 << new.refund_failures)));
  end if;
  return new;
end $$;
revoke all on function campusbite_private.backoff_refund_failure() from public, anon, authenticated;
create trigger backoff_refund_failure before update of refund_error on public.commerce_orders
  for each row execute function campusbite_private.backoff_refund_failure();

create or replace function public.claim_payment_webhooks(key_mode text) returns setof public.payment_webhook_queue
language sql security definer set search_path='' as $$
  update public.payment_webhook_queue q
    set attempts=q.attempts+1, due=now()+make_interval(mins=>least(360,1<<least(q.attempts,9)))
  where q.event_id in (
    select j.event_id from public.payment_webhook_queue j
    where j.completed_at is null and j.attempts<12 and j.due<=now() and j.mode=key_mode
    order by j.due limit 10 for update skip locked
  ) returning q.*
$$;

create function public.retry_reviewed_webhook(target_event text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not campusbite_private.is_admin() then raise insufficient_privilege; end if;
  update public.payment_webhook_queue set attempts=0, due=now()
    where event_id=target_event and completed_at is null and attempts>=12
      and mode=(select mode from public.razorpay_environment where singleton);
  return found;
end $$;
revoke all on function public.retry_reviewed_webhook(text) from public,anon,authenticated,service_role;
grant execute on function public.retry_reviewed_webhook(text) to authenticated;
commit;
