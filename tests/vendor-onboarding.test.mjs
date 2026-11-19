import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("historical applications and storefronts migrate, and a fourth shop can publish and suspend", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  const migrate = async name => db.exec(await readFile(new URL("../supabase/migrations/" + name + ".sql", import.meta.url), "utf8"));
  for (const name of ["202611180001_staff_access", "202611180002_commerce", "202611190001_shop_owner_team"]) await migrate(name);
  const admin = "00000000-0000-4000-8000-000000000001";
  await db.query("insert into auth.users values ($1,'admin@example.test',now())",[admin]);
  await db.exec(`
    insert into public.staff_admins values ('admin@example.test');
    insert into public.vendor_shops(name) values ('Existing kitchen');
    insert into public.commerce_stalls(slug,shop_id,capacity,enabled)
      select 'rolling-kitchen',id,7,true from public.vendor_shops;
    insert into public.vendor_applications(shop_name,contact_name,email,phone,location,status)
      values ('Fourth kitchen','Owner','vendor@example.test','1234567890','Stall 4','reviewed');
  `);
  await migrate("202611190002_vendor_onboarding");
  const adminQuery = (sql, params) => db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);
    return tx.query(sql,params);
  });
  const old = (await db.query("select * from public.commerce_stalls where slug='rolling-kitchen'")).rows[0];
  assert.equal(old.capacity,7);
  assert.equal(old.enabled,true);
  assert.equal(old.payment_status,"legacy_enabled");
  assert.equal((await db.query("select public from storage.buckets")).rows[0].public,false);
  const app = (await db.query("select * from public.vendor_applications")).rows[0];
  assert.equal(app.status,"under_review");
  const review = (revision,decision,note="") => adminQuery("select public.review_vendor_application($1,$2,$3,$4)",[app.id,revision,decision,note]);
  await assert.rejects(review(0,"approved"),/missing onboarding/);
  await review(0,"changes_requested","Please confirm the hours and registration.");
  await db.query(`update public.vendor_applications set status='submitted', revision=2, verified_at=now(),
    applicant_id=gen_random_uuid(),agreed_at=now(), agreement_version='pilot-v1',opens='09:00',closes='18:00',court='block-41',
    cuisine='Snacks',registration='Registration on file' where id=$1`,[app.id]);
  await review(2,"under_review");
  await review(3,"approved");
  await assert.rejects(review(3,"approved"),/changed/);
  const shop = (await db.query("select shop_id from public.vendor_applications where id=$1",[app.id])).rows[0].shop_id;
  assert.equal((await db.query("select role from public.vendor_access where shop_id=$1",[shop])).rows[0].role,"owner");
  const details = { slug:"fourth-kitchen", display_name:"Fourth kitchen", court:"block-41", location:"Stall 4", cuisine:"Snacks",
    opens:"09:00",closes:"18:00",capacity:4,payment_status:"not_started",provider_ref:"",standing:"approved",published:true,enabled:false };
  const save = (rev, changes) => adminQuery("select public.save_vendor_storefront($1,$2,$3)",[shop,rev,{ ...details,...changes }]);
  await save(-1,{});
  assert.equal((await db.query("select count(*)::int as total from public.commerce_stalls where published")).rows[0].total,4);
  await assert.rejects(save(1,{enabled:true}),/verify payment/);
  await assert.rejects(save(1,{payment_status:"verified"}),/provider account/);
  await adminQuery(`insert into public.commerce_menu(id,stall_slug,name,price,category,description,prep,diet,photo)
    values ('tea','fourth-kitchen','Tea',2000,'Drinks','Tea',5,'Vegetarian','')`);
  await save(1,{enabled:true,payment_status:"verified",provider_ref:"test-account"});
  await assert.rejects(save(1,{published:false}),/changed/);
  await save(2,{standing:"suspended"});
  const suspended=(await db.query("select enabled,published from public.commerce_stalls where shop_id=$1",[shop])).rows[0];
  assert.deepEqual(suspended,{enabled:false,published:false});
  assert.equal((await db.query("select status from public.vendor_applications where shop_id=$1",[shop])).rows[0].status,"suspended");
  await save(3,{published:false});
  assert.equal((await db.query("select status from public.vendor_applications where shop_id=$1",[shop])).rows[0].status,"approved");
});
