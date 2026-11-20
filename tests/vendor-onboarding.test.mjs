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

  await migrate("202611200001_vendor_workspace");
  const vendor = "00000000-0000-4000-8000-000000000021";
  await db.query("insert into auth.users values ($1,'vendor@example.test',now())",[vendor]);
  const vendorQuery = (sql,params=[]) => db.transaction(async tx=>{
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[vendor]);
    return tx.query(sql,params);
  });
  const fields = {name:"Cold tea",description:"Tea on ice",category:"Drinks",price:2400,prep:6,diet:"Vegetarian",photo:"",sold_out:false,archived:false};
  const writeItem = (rev,changes={})=>vendorQuery("select vendor_write_item($1,'cold-tea',$2,$3)",[shop,rev,{...fields,...changes}]);
  await writeItem(-1);
  await writeItem(0,{archived:true});
  await assert.rejects(writeItem(0),/changed/);
  await writeItem(1);
  await save(4,{enabled:true,payment_status:"verified",provider_ref:"test-account"});
  const availability = (rev,paused)=>vendorQuery("select vendor_set_availability($1,$2,'09:00','16:00',3,2,$3,array['2027-02-11'::date])",[shop,rev,paused]);
  await availability(5,true);
  await assert.rejects(availability(5,false),/changed/);
  const insert = async (date,qty) => (await db.query(`insert into commerce_orders(student_id,request_id,fingerprint,shop_id,pickup_at,reserved_until,detail,amount_paise)
    values(gen_random_uuid(),gen_random_uuid(),'test',$1,$2,now()+interval '1 hour',$3,2400) returning id`,
    [shop,date,{items:[{id:"cold-tea",name:"Cold tea",qty,price:2400}],note:"Less ice"}])).rows[0].id;
  await assert.rejects(insert("2027-02-10T12:00+05:30",1),/closed/);
  await availability(6,false);
  await assert.rejects(insert("2027-02-11T12:00+05:30",1),/closed/);
  await assert.rejects(insert("2027-02-10T15:55+05:30",1),/closed/);
  await assert.rejects(insert("2027-02-10T12:00+05:30",3),/basket/);
  const purchase = await insert("2027-02-10T12:00+05:30",1);
  await db.query("update commerce_orders set provider_order='workspace-test' where id=$1",[purchase]);
  await db.exec("select commerce_capture('workspace-test','workspace-payment',2400,'INR')");
  await writeItem(2,{prep:12});
  const feed = async ()=> (await vendorQuery("select vendor_order_feed($1,$2) as orders",[shop,purchase])).rows[0].orders;
  assert.equal((await feed())[0].prep_minutes,6);
  assert.ok((await feed())[0].accept_until);
  assert.equal((await vendorQuery("select commerce_fulfill($1,'rejected','') as ok",[purchase])).rows[0].ok,false);
  await assert.rejects(vendorQuery("select vendor_reject_order($1,' ')",[purchase]),/reason/);
  assert.equal((await vendorQuery("select vendor_reject_order($1,'Equipment repair') as ok",[purchase])).rows[0].ok,true);
  const [rejected] = await feed();
  assert.equal(rejected.rejection_reason,"Equipment repair");
  assert.equal(rejected.refund,"Requested");
  assert.equal(rejected.events.at(-1).status,"Rejected");
  assert.equal("pickup_code" in rejected,false);
  assert.deepEqual((await vendorQuery("select vendor_earnings($1,now()-interval '1 hour',now()+interval '1 hour') as totals",[shop])).rows[0].totals,
    {captured:2400,orders:1,refunded:0,refund_pending:2400});
  await migrate("202611200002_menu_categories_weekly_pickup");
  const category = (previous,name) => vendorQuery("select vendor_save_category($1,$2,$3)",[shop,previous,name]);
  const schedule = (revision,weekly,minutes) => vendorQuery("select vendor_set_schedule($1,$2,'09:00','16:00',3,2,false,array['2027-02-11'::date],$3,$4)",[shop,revision,weekly,minutes]);
  assert.equal((await feed())[0].pickup_minutes,10);
  await category("","Iced drinks");
  await writeItem(3,{category:"Iced drinks"});
  await category("Iced drinks","Coolers");
  const renamed = (await db.query("select category,revision from commerce_menu where id='cold-tea'")).rows[0];
  assert.equal(renamed.category,"Coolers");
  await assert.rejects(category("","coolers"),/already exists/);
  await assert.rejects(writeItem(renamed.revision,{category:"Iced drinks"}),/category/);
  await assert.rejects(schedule(7,{Monday:{opens:"17:00",closes:"09:00"}},15),/weekday/);
  await schedule(7,{Saturday:{opens:"10:05",closes:"12:00"},Sunday:null},15);
  const insertWindow = (date,minutes) => db.query(`insert into commerce_orders(student_id,request_id,fingerprint,shop_id,pickup_at,reserved_until,detail,amount_paise)
    values(gen_random_uuid(),gen_random_uuid(),'window',$1,$2,now()+interval '1 hour',$3,2400) returning pickup_minutes`,
    [shop,date,{pickup_minutes:minutes,items:[{id:"cold-tea",qty:1,price:2400}]}]);
  assert.equal((await insertWindow("2027-02-13T10:20+05:30",15)).rows[0].pickup_minutes,15);
  await assert.rejects(insertWindow("2027-02-13T10:15+05:30",15),/window changed/);
  await assert.rejects(insertWindow("2027-02-13T10:20+05:30",10),/window changed/);
  await assert.rejects(insertWindow("2027-02-13T11:50+05:30",15),/closed/);
  await assert.rejects(insertWindow("2027-02-14T11:00+05:30",15),/closed/);
  await assert.rejects(insertWindow("2027-02-11T11:00+05:30",15),/closed/);
  assert.equal((await insertWindow("2027-02-12T09:00+05:30",15)).rows[0].pickup_minutes,15);
  assert.equal((await feed())[0].pickup_minutes,10);
  // Exercise the checkout RPC with an actual future reservation and change the
  // grid while its payment hold is active. The two windows overlap by 5 minutes.
  const minute = 60000;
  let slot = Math.ceil((Date.now()+20*minute)/minute)*minute;
  const localMinute = Math.floor((slot+330*minute)/minute)%1440;
  if (localMinute>1410) slot += (1440-localMinute)*minute;
  const configure = async (opens,minutes) => db.query(`update commerce_stalls set weekly_hours='{}',closed_dates='{}',
    opens=($2::timestamptz at time zone 'Asia/Kolkata')::time,closes='23:59',capacity=1,pickup_minutes=$3 where shop_id=$1`,
    [shop,new Date(opens).toISOString(),minutes]);
  const reserve = (start,minutes) => db.query(`select (commerce_reserve(gen_random_uuid(),gen_random_uuid(),'test','fourth-kitchen',$1,$2,2400)).pickup_minutes as duration`,
    [new Date(start).toISOString(),{pickup_minutes:minutes,note:"",items:[{id:"cold-tea",name:"Cold tea",qty:1,price:2400}]}]);
  await configure(slot,10);
  assert.equal((await reserve(slot,10)).rows[0].duration,10);
  await configure(slot+5*minute,15);
  await assert.rejects(reserve(slot+5*minute,15),/full/);
  // If the grid was moved past midnight, the horizon may end before the next slot.
  if ((localMinute>1410 || localMinute+35<=1439) && slot+20*minute<Date.now()+60*minute) assert.equal((await reserve(slot+20*minute,15)).rows[0].duration,15);
  await migrate("202611200003_pickup_availability_inventory");
  await t.test("shared availability, expiring stock holds and late capture use the original window",async()=>{
    const {randomUUID}=await import("node:crypto");
    await assert.rejects(vendorQuery("select commerce_pickup_availability('fourth-kitchen','[]')"),/permission denied/);
    const items=[{id:"cold-tea",qty:1,price:2400}];
    const detail={items:items.map(i=>({...i,name:"Cold tea"})),pickup_minutes:5,note:""};
    await db.query("update commerce_orders set reserved_until=now()-interval '1 minute' where shop_id=$1 and status='unpaid'",[shop]);
    await configure(slot,5);
    const stamp=new Date(slot).toISOString();
    const quote=async (actor=null,request=null)=>(await db.query("select commerce_pickup_availability('fourth-kitchen',$1,$2,$3) as quote",[JSON.stringify(items),actor,request])).rows[0].quote;
    const book=async (start=stamp,actor=randomUUID(),request=randomUUID())=>{
      const row=(await db.query("select (commerce_reserve($1,$2,'repeat','fourth-kitchen',$3,$4,2400)).id",[actor,request,start,detail])).rows[0];
      await db.query("update commerce_orders set provider_order=id::text where id=$1",[row.id]);
      return row.id;
    };
    const capture=async id=>(await db.query("select commerce_capture($1,$2,2400,'INR') as ok",[id,"pay_"+id])).rows[0].ok;
    const state=async id=>(await db.query("select status,refund,pickup_at,stock_committed from commerce_orders where id=$1",[id])).rows[0];
    const expire=id=>db.query("update commerce_orders set reserved_until=now()-interval '1 second' where id=$1",[id]);
    const stock=async ()=>(await db.query("select stock_remaining from commerce_menu where id='cold-tea'")).rows[0].stock_remaining;
    await db.exec("update commerce_menu set stock_remaining=2 where id='cold-tea'");
    assert.ok((await quote()).slots.some(w=>w.start===slot));
    const shopper=randomUUID(),key=randomUUID(),first=await book(stamp,shopper,key);
    assert.equal(await book(stamp,shopper,key),first);
    assert.ok(!(await quote()).slots.some(w=>w.start===slot));
    assert.ok((await quote(shopper,key)).slots.some(w=>w.start===slot));
    assert.ok(!(await quote(randomUUID(),key)).slots.some(w=>w.start===slot));
    await assert.rejects(book(),/full/);
    await db.exec("update commerce_menu set stock_remaining=1 where id='cold-tea'");
    await assert.rejects(db.exec("update commerce_menu set stock_remaining=0 where id='cold-tea'"),/held in checkout/);
    assert.match((await quote()).message,/stock/);
    await expire(first);
    await db.exec("select * from commerce_refund_jobs()");
    assert.equal((await state(first)).status,"expired");
    assert.ok((await quote()).slots.some(w=>w.start===slot));
    assert.equal(await capture(first),true);
    assert.equal((await state(first)).status,"awaiting");
    assert.equal(new Date((await state(first)).pickup_at).toISOString(),stamp);
    assert.equal(await capture(first),true);
    assert.equal(await stock(),0);
    await vendorQuery("select vendor_reject_order($1,'Kitchen closed')",[first]);
    assert.equal(await stock(),1);
    assert.equal(await capture(first),true);
    assert.equal(await stock(),1);

    await db.query("update commerce_stalls set capacity=5 where shop_id=$1",[shop]);
    const lastUnit=await Promise.allSettled([book(),book(new Date(slot+5*minute).toISOString())]);
    assert.equal(lastUnit.filter(r=>r.status==="fulfilled").length,1);
    assert.match(lastUnit.find(r=>r.status==="rejected").reason.message,/stock/);
    const late=lastUnit.find(r=>r.status==="fulfilled").value;
    await expire(late);
    const winner=await book();
    assert.equal(await capture(late),true);
    assert.equal((await state(late)).refund,"Requested");
    assert.equal((await db.query("select id from vendor_orders where id=$1",[late])).rows.length,0);
    assert.equal(await stock(),1);
    await expire(winner);
    await db.exec("update commerce_menu set stock_remaining=null where id='cold-tea'");
    await db.query("update commerce_stalls set capacity=1 where shop_id=$1",[shop]);
    const replacement=await book();
    await capture(winner);
    assert.equal((await state(winner)).refund,"Requested");
    await expire(replacement);
    await db.exec("update commerce_menu set prep=50 where id='cold-tea'");
    await capture(replacement);
    assert.equal((await state(replacement)).refund,"Requested");
  });
  const other = (await db.query("select id from vendor_shops where id<>$1 limit 1",[shop])).rows[0].id;
  await assert.rejects(vendorQuery("select vendor_order_feed($1)",[other]));
  await db.query("update vendor_access set role='staff' where shop_id=$1",[shop]);
  assert.equal((await feed())[0].status,"rejected");
  await assert.rejects(category("","Staff category"));
  await assert.rejects(schedule(8,{},20));
  await assert.rejects(writeItem(3),/management/);
  await assert.rejects(availability(7,true),/management/);
  await assert.rejects(vendorQuery("select vendor_earnings($1,now(),now())",[shop]));
});
