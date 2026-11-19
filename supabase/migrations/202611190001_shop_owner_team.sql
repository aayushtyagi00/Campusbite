begin;

create policy access_owner_read on public.vendor_access for select to authenticated
  using (campusbite_private.has_shop_role(shop_id, array['owner']));

create policy access_owner_insert on public.vendor_access for insert to authenticated
  with check (role in ('staff', 'manager') and campusbite_private.has_shop_role(shop_id, array['owner']));

create policy access_owner_update on public.vendor_access for update to authenticated
  using (role in ('staff', 'manager') and campusbite_private.has_shop_role(shop_id, array['owner']))
  with check (role in ('staff', 'manager') and campusbite_private.has_shop_role(shop_id, array['owner']));

create policy access_owner_delete on public.vendor_access for delete to authenticated
  using (role in ('staff', 'manager') and campusbite_private.has_shop_role(shop_id, array['owner']));

commit;
