import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("commerce keeps reservations, payment state, and shop access consistent", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const file of ["202611180001_staff_access", "202611180002_commerce", "202611220001_razorpay_payments"]) {
    await db.exec(await readFile(new URL("../supabase/migrations/" + file + ".sql", import.meta.url), "utf8"));
  }
  const student = "10000000-0000-0000-0000-000000000001";
  const stranger = "10000000-0000-0000-0000-000000000002";
  const vendor = "10000000-0000-0000-0000-000000000003";
  const request = "10000000-0000-0000-0000-000000000004";
  const as = (role, fn) => db.transaction(async transaction => {
    await transaction.exec("set local role " + role);
    return fn(transaction);
  });
  const get = result => Object.values(result.rows[0])[0];
  const slot = get(await db.query("select to_timestamp(ceil(extract(epoch from now()) / 600) * 600 + 1200)::text"));
  const detail = JSON.stringify({ items: [{ id: "tea", name: "Tea", price: 4000, qty: 1 }], note: "" });
  await db.exec(`
    insert into public.vendor_shops (name) values ('Tea shop'), ('Other shop');
    insert into public.commerce_stalls (slug,shop_id,capacity,enabled)
      select 'test-tea',id,1,true from public.vendor_shops where name = 'Tea shop';
    insert into public.commerce_menu (id,stall_slug,name,category,description,price,prep,diet,photo)
      values ('tea','test-tea','Tea','Drinks','Test item',4000,4,'Vegetarian','');
    insert into auth.users values ('${vendor}', 'vendor@example.test', now()), ('${stranger}', 'other@example.test', now());
    insert into public.vendor_access (shop_id,email,role)
      select id,'vendor@example.test','staff' from public.vendor_shops where name = 'Tea shop';
    insert into public.vendor_access (shop_id,email,role)
      select id,'other@example.test','owner' from public.vendor_shops where name = 'Other shop';
  `);
  const reserve = (actor, key, fingerprint = "original", time = slot) => as("service_role", tx =>
    tx.query("select (public.commerce_reserve($1,$2,$3,'test-tea',$4,$5,4000)).id", [actor, key, fingerprint, time, detail]).then(get));
  const capture = (gateway, payment, amount = 4000) => as("service_role", tx =>
    tx.query("select public.commerce_capture($1,$2,$3,'INR')", [gateway, payment, amount]).then(get));
  const cancel = (actor, id) => as("service_role", tx =>
    tx.query("select public.commerce_cancel($1,$2)", [actor, id]).then(get));
  const fulfill = (actor, id, status, code = "") => as("authenticated", async tx => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    return tx.query("select public.commerce_fulfill($1,$2,$3)", [id, status, code]).then(get);
  });

  const id = await reserve(student, request);
  await t.test("reservations are idempotent and charge data cannot be supplied by a public database client", async () => {
    assert.equal(await reserve(student, request), id);
    await assert.rejects(reserve(student, request, "changed"), /Checkout changed/);
    await assert.rejects(reserve(stranger, request), /Pickup window is full/);
    await assert.rejects(as("authenticated", tx => tx.query("select * from public.commerce_orders")), /permission denied/);
    await assert.rejects(as("authenticated", tx =>
      tx.query("select public.commerce_reserve($1,$2,'s','test-tea',$3,$4,4000)", [student, request, slot, detail])), /permission denied/);
  });
  await t.test("payment can only be recorded at the stored amount and is applied once", async () => {
    await db.query("update public.commerce_orders set provider_order='order_A' where id=$1", [id]);
    const event = (role, mode, amount) => as(role, tx => tx.query(
      "select public.commerce_apply_razorpay_event('webhook:delivery-A','payment.captured','pay_A','order_A',$1,'INR',$2)", [amount,mode]).then(get));
    assert.equal(await event("service_role","test",4000),false);
    await assert.rejects(event("authenticated","live",4000),/permission denied/);
    await assert.rejects(as("service_role", tx => tx.query("update public.razorpay_environment set mode='test'")),/permission denied/);
    await assert.rejects(event("service_role","live",3999),/reconciliation/);
    assert.equal(await capture("order_A", "pay_A", 3999), false);
    assert.equal(await event("service_role","live",4000),true);
    assert.equal(await event("service_role","live",4000),true);
    assert.equal(Number(get(await db.query("select count(*) from campusbite_private.razorpay_events"))),1);
    assert.equal(await capture("order_A", "pay_A"), true);
    assert.equal(await capture("order_A", "pay_B"), false);
    assert.equal(Number(get(await db.query("select count(*) from public.vendor_orders"))), 1);
  });
  await t.test("checkout checks updated menu prices and only the assigned shop can edit them", async () => {
    const patchPrice = (actor, price) => as("authenticated", async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      return tx.query("update public.commerce_menu set price=$1 where id='tea' returning price", [price]);
    });
    assert.equal((await patchPrice(stranger, 3600)).rows.length, 0);
    assert.equal((await patchPrice(vendor, 3600)).rows.length, 0);
    await db.exec("update public.vendor_access set role='manager' where email='vendor@example.test'");
    assert.equal(get(await patchPrice(vendor, 3600)), 3600);
    await assert.rejects(reserve(stranger, request, "new price"), /An item or price changed/);
    assert.equal(get(await patchPrice(vendor, 4000)), 4000);
    await db.exec("update public.vendor_access set role='staff' where email='vendor@example.test'");
  });
  await t.test("only assigned staff can fulfill and students cannot cancel someone else's order", async () => {
    assert.equal(await fulfill(stranger, id, "accepted"), false);
    assert.equal(await cancel(stranger, id), false);
    assert.equal(await fulfill(vendor, id, "ready"), false);
    assert.equal(await fulfill(vendor, id, "accepted"), true);
    assert.equal(await cancel(student, id), false);
    assert.equal(await fulfill(vendor, id, "preparing"), true);
    assert.equal(await fulfill(vendor, id, "ready"), true);
    const pickupCode = get(await db.query("select pickup_code from public.commerce_orders where id=$1", [id]));
    assert.match(pickupCode, /^\d{6}$/);
    assert.equal(await fulfill(vendor, id, "collected", "nope"), false);
    assert.equal(await fulfill(vendor, id, "collected", pickupCode), true);
    assert.equal(Number(get(await db.query("select count(*) from public.vendor_sales"))), 1);
  });
  await t.test("late capture creates a durable refund without entering the vendor board", async () => {
    const lateSlot = new Date(Date.parse(slot) + 600_000).toISOString();
    const late = await reserve(stranger, request, "late", lateSlot);
    await db.query("update public.commerce_orders set provider_order='order_Late',reserved_until=now()-interval '1 second' where id=$1", [late]);
    assert.equal(await capture("order_Late", "pay_Late"), true);
    assert.equal(get(await db.query("select status from public.commerce_orders where id=$1", [late])), "expired");
    assert.equal(Number(get(await db.query("select count(*) from public.vendor_orders"))), 1);
    const jobs = await as("service_role", tx => tx.query("select * from public.commerce_refund_jobs()"));
    assert.deepEqual(jobs.rows, [{ id: late, payment: "pay_Late", amount: 4000 }]);
    assert.equal((await as("service_role", tx => tx.query("select * from public.commerce_refund_jobs()"))).rows.length, 0);
    assert.equal(await as("service_role", tx => tx.query("select public.commerce_record_refund('pay_Late',4000,'Succeeded')").then(get)), true);
    assert.equal(await as("service_role", tx => tx.query("select public.commerce_record_refund('pay_Late',4000,'Pending')").then(get)), false);
  });
});
