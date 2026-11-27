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
  for (const migration of ["202611220001_razorpay_payments","202611230001_overnight_pickup","202611230002_order_operations",
    "202611230003_recovery_and_push","202611230004_pickup_policy"]) await migrate(migration);
  await db.query("update vendor_access set role='owner' where shop_id=$1",[shop]);
  const fit=async stamp=>(await db.query("select campusbite_private.pickup_fits(s,$2,10) as fits from commerce_stalls s where shop_id=$1",[shop,stamp])).rows[0].fits;
  await db.query("update commerce_stalls set weekly_hours='{}',opens='20:00',closes='00:30',pickup_minutes=10,closed_dates='{}' where shop_id=$1",[shop]);
  assert.equal(await fit("2027-02-14T00:20+05:30"),true);
  assert.equal(await fit("2027-02-14T00:30+05:30"),false);
  await db.query("update commerce_stalls set closed_dates=array['2027-02-14'::date] where shop_id=$1",[shop]);
  assert.equal(await fit("2027-02-14T00:20+05:30"),false);
  await db.query("update commerce_stalls set closed_dates='{}' where shop_id=$1",[shop]);
  await assert.rejects(vendorQuery("select set_ordering_pause(true)"));
  await adminQuery("select set_ordering_pause(true)");
  await assert.rejects(insertWindow("2027-02-14T00:20+05:30",10),/paused/);
  await adminQuery("select set_ordering_pause(false)");
  await insertWindow("2027-02-14T00:20+05:30",10);
  const ready=(await db.query("update commerce_orders set status='ready',pickup_code='001234' where fingerprint='window' returning id,student_id")).rows[0];
  await migrate("202611230005_protected_handoff");
  const getCode=async(student,id)=>(await db.query("select code from student_pickup_codes($1,array[$2::uuid])",[student,id])).rows[0]?.code;
  assert.equal(await getCode(ready.student_id,ready.id),"001234");
  assert.equal(await getCode(vendor,ready.id),undefined);
  await assert.rejects(vendorQuery("select * from student_pickup_codes($1,array[$2::uuid])",[ready.student_id,ready.id]));
  const fulfill=async(id,status,code="")=>(await vendorQuery("select commerce_fulfill($1,$2,$3) as ok",[id,status,code])).rows[0].ok;
  assert.equal(await fulfill(ready.id,"collected","000000"),false);
  assert.equal(await fulfill(ready.id,"collected","001234"),true);
  assert.equal(await fulfill(ready.id,"collected","001234"),false);
  assert.equal((await db.query("select collected_by from commerce_orders where id=$1",[ready.id])).rows[0].collected_by,vendor);
  await db.query("update commerce_orders set status='awaiting',provider_payment='pay_legacy',accept_until=now()+interval '1 hour',detail=detail||jsonb_build_object('holding_minutes',5) where id=$1",[ready.id]);
  assert.equal(await fulfill(ready.id,"accepted"),true);
  assert.match(await getCode(ready.student_id,ready.id),/^[0-9]{6}$/);
  assert.equal(await fulfill(ready.id,"preparing"),true);
  assert.equal(await fulfill(ready.id,"ready"),true);
  await db.query("update commerce_orders set holding_until=now()-interval '1 minute' where id=$1",[ready.id]);
  assert.equal(await fulfill(ready.id,"collected","001234"),false);
  await db.exec("select expire_uncollected()");
  assert.equal((await db.query("select status from commerce_orders where id=$1",[ready.id])).rows[0].status,"uncollected");
  await assert.rejects(vendorQuery("select review_order_case($1,0,'resolved','Done',true)",[ready.id]));
  assert.equal((await adminQuery("select review_order_case($1,0,'resolved','Refund approved',true) as ok",[ready.id])).rows[0].ok,true);
  assert.equal((await adminQuery("select review_order_case($1,0,'open','Retry',true) as ok",[ready.id])).rows[0].ok,false);
  await db.query("insert into push_subscriptions(endpoint,keys,audience,student_id) values ('https://push.example/test','{}','student',$1)",[ready.student_id]);
  await db.query("update commerce_orders set refund='Pending' where id=$1",[ready.id]);
  const jobs=(await db.query("select * from claim_order_push()")).rows;
  assert.equal(jobs.length,1);
  assert.equal((await db.query("select * from claim_order_push()")).rows.length,0);
  await db.query("select finish_order_push($1,$2,null)",[jobs[0].id,jobs[0].lease]);
  await db.exec("update commerce_orders set provider_order=id::text where provider_order is null and provider_payment is null");
  await db.exec("update commerce_orders set recovery_due=now()-interval '1 minute' where provider_order is not null and provider_payment is null");
  const recovering=(await db.query("select * from claim_payment_recovery()")).rows;
  assert.ok(recovering.length);
  assert.equal((await db.query("select * from claim_payment_recovery()")).rows.length,0);
  await migrate("202611230006_payment_journal");
  await db.query("update commerce_orders set provider_order='order_Ref' where id=$1",[ready.id]);
  const apply=(event,kind,payment)=>db.query("select commerce_apply_razorpay_event($1,$2,$3,'order_Ref',2400,'INR','live') as applied",[event,kind,payment]);
  for (let i=0;i<2;i++) assert.equal((await apply("webhook:duplicate","payment.captured","pay_Extra")).rows[0].applied,true);
  assert.equal((await apply("webhook:extra-refund","refund.processed","pay_Extra")).rows[0].applied,true);
  assert.deepEqual((await db.query("select kind from payment_journal where order_id=$1 order by id",[ready.id])).rows.map(r=>r.kind),["capture","extra_capture","extra_refund"]);
  await db.exec("create table auth.mfa_factors(user_id uuid,status text); create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$");
  await migrate("202611230007_admin_mfa");
  assert.equal((await adminQuery("select campusbite_is_admin() as ok")).rows[0].ok,true);
  await db.query("insert into auth.mfa_factors values($1,'verified')",[admin]);
  assert.equal((await adminQuery("select campusbite_is_admin() as ok")).rows[0].ok,false);
  await migrate("202611230008_food_courts");
  await migrate("202611240001_public_reviews");
  await migrate("202611240002_payment_retries");
  await t.test("payment retries back off and exhausted verification requires admin review", async () => {
    await db.query("update commerce_orders set refund='Pending',refund_after=now(),refund_error=null where id=$1", [ready.id]);
    for (let i=0; i<2; i++)
      await db.query("update commerce_orders set refund_error='Refund submission needs review' where id=$1", [ready.id]);
    const state = await db.query("select refund_failures, refund_after >= now()+interval '3 minutes' as delayed from commerce_orders where id=$1",[ready.id]);
    assert.deepEqual(state.rows[0], { refund_failures: 2, delayed: true });
    await db.query("update commerce_orders set refund_error=null where id=$1", [ready.id]);
    assert.equal((await db.query("select refund_failures from commerce_orders where id=$1",[ready.id])).rows[0].refund_failures,0);

    const event = "entity:live:payment.captured:pay_Review";
    await db.query(`insert into payment_webhook_queue(event_id,kind,payment,amount,mode,attempts)
      values($1,'payment.captured','pay_Review',2400,'live',11)`,[event]);
    assert.equal((await db.query("select attempts from claim_payment_webhooks('live') where event_id=$1",[event])).rows[0].attempts,12);
    await db.query("update payment_webhook_queue set due=now() where event_id=$1",[event]);
    assert.equal((await db.query("select * from claim_payment_webhooks('live') where event_id=$1",[event])).rows.length,0);
    await assert.rejects(vendorQuery("select retry_reviewed_webhook($1)",[event]));
    await db.transaction(async tx => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [admin,'{"aal":"aal2"}']);
      assert.equal((await tx.query("select retry_reviewed_webhook($1) as queued",[event])).rows[0].queued,true);
      assert.equal((await tx.query("select retry_reviewed_webhook($1) as queued",[event])).rows[0].queued,false);
    });
    assert.equal((await db.query("select attempts from claim_payment_webhooks('live') where event_id=$1",[event])).rows[0].attempts,1);
  });
  await t.test("reviews are readable and writable only through the server", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query(`select
        has_table_privilege($1,'public.campus_reviews','select') as read,
        has_column_privilege($1,'public.campus_reviews','name','insert') as submit,
        has_column_privilege($1,'public.campus_reviews','created_at','insert') as set_timestamp`, [role]);
      assert.deepEqual(rows[0], { read: role === "service_role", submit: role === "service_role", set_timestamp: false });
    }
  });
  assert.equal((await vendorQuery("select id from food_courts")).rows.length,4);
  await assert.rejects(vendorQuery("insert into food_courts values('private','Unauthorized',10)"));
  await t.test("new checkout uses vendor timing and one protected handoff from reservation through capture",async t=>{
    await migrate("202611240003_payment_integrity");
    const {randomUUID}=await import("node:crypto");
    const revision=(await db.query("select revision from commerce_stalls where shop_id=$1",[shop])).rows[0].revision;
    await vendorQuery("select vendor_set_pickup_policy($1,$2,120,45,1,5,30)",[shop,revision]);
    await db.query("update commerce_stalls set opens='01:00',closes='00:59',weekly_hours='{}',closed_dates='{}',pickup_minutes=5,capacity=30,vendor_paused=false where shop_id=$1",[shop]);
    await db.exec("update commerce_menu set prep=3,stock_remaining=null where id='cold-tea'");
    const items=[{id:"cold-tea",qty:1,price:2400}];
    const offered=(await db.query("select commerce_pickup_availability('fourth-kitchen',$1) as quote",[JSON.stringify(items)])).rows[0].quote;
    const pick=offered.slots.find(w=>w.start>Date.now()+65*60000);
    assert.ok(pick,"configured two-hour horizon includes a slot beyond one hour");
    const actor=randomUUID(),request=randomUUID(),stamp=new Date(pick.start).toISOString();
    const line={pickup_minutes:5,items,note:""};
    const reserve=()=>db.query("select (commerce_reserve($1,$2,'fingerprint','fourth-kitchen',$3,$4,2400)).id",[actor,request,stamp,line]);
    const id=(await reserve()).rows[0].id;
    assert.equal((await reserve()).rows[0].id,id);
    assert.equal(await getCode(actor,id),undefined);
    assert.deepEqual((await vendorQuery("select vendor_order_feed($1,$2) as orders",[shop,id])).rows[0].orders,[]);
    for (const role of ["anon","authenticated","service_role"]) {
      const privileges=(await db.query(`select has_function_privilege($1,'commerce_capture(text,text,integer,text)','execute') as raw_capture,
        has_table_privilege($1,'vendor_orders','insert') as insert_ticket,
        has_column_privilege($1,'commerce_orders','provider_payment','update') as write_capture`,[role])).rows[0];
      assert.deepEqual(privileges,{raw_capture:false,insert_ticket:false,write_capture:false});
    }
    await db.query("update commerce_orders set provider_order='order_New' where id=$1",[id]);
    const captured=()=>db.query("select commerce_apply_razorpay_event('webhook:fresh','payment.captured','pay_New','order_New',2400,'INR','live') as ok");
    assert.equal((await captured()).rows[0].ok,true);
    assert.equal((await captured()).rows[0].ok,true);
    assert.equal(await fulfill(id,"accepted"),true);
    const code=await getCode(actor,id);
    assert.match(code,/^[0-9]{6}$/);
    assert.equal(await fulfill(id,"collected",code),false);
    assert.equal(await fulfill(id,"preparing"),true);
    assert.equal(await fulfill(id,"ready"),true);
    const order=(await db.query("select pickup_code,holding_until from commerce_orders where id=$1",[id])).rows[0];
    assert.equal(order.pickup_code,"");
    assert.equal(new Date(order.holding_until).getTime(),pick.end+30*60000);
    assert.equal(await fulfill(id,"collected",code),true);
    assert.equal(await fulfill(id,"collected",code),false);
    assert.equal((await db.query("select count(*)::int as n from payment_journal where order_id=$1",[id])).rows[0].n,1);
    await t.test("paid orders with the same short reference both reach the kitchen",async()=>{
      const reservation=(await db.query("select (commerce_reserve($1,$2,'reference-test','fourth-kitchen',$3,$4,2400)).id",
        [actor,randomUUID(),stamp,line])).rows[0].id;
      const collidingId=id.slice(0,8)+randomUUID().slice(8);
      await db.query("update commerce_orders set id=$1,provider_order='order_Collision' where id=$2",[collidingId,reservation]);
      const result=await db.query("select commerce_apply_razorpay_event('reference-test','payment.captured','pay_Collision','order_Collision',2400,'INR','live') as ok");
      assert.equal(result.rows[0].ok,true);
      const refs=await db.query("select v.reference,o.detail->>'reference' as student from vendor_orders v join commerce_orders o using(id) where v.id=$1",[collidingId]);
      assert.deepEqual(refs.rows[0],{reference:"CB-"+collidingId.toUpperCase(),student:"CB-"+collidingId.toUpperCase()});
    });
    await t.test("a verified merchant refund closes an open ticket and withdraws its handoff code",async()=>{
      const refunded=(await db.query("select (commerce_reserve($1,$2,'refund-test','fourth-kitchen',$3,$4,2400)).id",
        [actor,randomUUID(),stamp,line])).rows[0].id;
      await db.query("update commerce_orders set provider_order='order_External' where id=$1",[refunded]);
      const event=(kind)=>db.query("select commerce_apply_razorpay_event($1,$2,'pay_External','order_External',2400,'INR','live') as ok",
        ["merchant-"+kind,kind]);
      assert.equal((await event("payment.captured")).rows[0].ok,true);
      assert.equal(await fulfill(refunded,"accepted"),true);
      assert.equal(await fulfill(refunded,"preparing"),true);
      assert.equal(await fulfill(refunded,"ready"),true);
      const issued=await getCode(actor,refunded);
      assert.match(issued,/^\d{6}$/);
      assert.equal((await event("refund.processed")).rows[0].ok,true);
      assert.equal((await event("refund.processed")).rows[0].ok,true);
      assert.equal(await getCode(actor,refunded),undefined);
      assert.equal(await fulfill(refunded,"collected",issued),false);
      const order=(await db.query(`select o.status,o.refund,v.status as ticket from commerce_orders o
        join vendor_orders v using(id) where o.id=$1`,[refunded])).rows[0];
      assert.deepEqual(order,{status:"cancelled",refund:"Succeeded",ticket:"cancelled"});
      assert.equal((await db.query("select count(*)::int as n from payment_journal where order_id=$1 and kind='refund'",[refunded])).rows[0].n,1);
    });
  });
  await t.test("vendor and owner permissions follow the verified portal session and the current database grants", async () => {
    const { randomUUID } = await import("node:crypto");
    await db.exec(`
      create table auth.sessions(id uuid primary key, user_id uuid references auth.users);
      create table auth.identities(user_id uuid references auth.users, provider text, provider_id text, identity_data jsonb);
      alter table auth.mfa_factors add column factor_type text default 'totp';
    `);
    await migrate("202611240004_vendor_access");
    await migrate("202611240005_owner_admin");
    const owner = randomUUID(), ownerLogin = randomUUID(), ordinaryLogin = randomUUID(), previousAdmin = randomUUID();
    const vendorLogin = randomUUID(), applicantLogin = randomUUID(), ownerEmail = "tyagiaayush3030@gmail.com";
    await db.query("insert into auth.users values($1,$2,now())", [owner, ownerEmail]);
    for (const [id, user] of [[ownerLogin, owner], [ordinaryLogin, owner], [previousAdmin, admin], [vendorLogin, vendor], [applicantLogin, vendor]])
      await db.query("insert into auth.sessions values($1,$2)", [id, user]);
    await db.query("insert into auth.identities values($1,'google','owner-sub',$2),($3,'google','other-sub',$4)", [
      owner, { email: ownerEmail, email_verified: false }, admin, { email: "admin@example.test", email_verified: true },
    ]);
    async function portal(user, session, sql, params = [], claims = {}) {
      return db.transaction(async tx => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [user, JSON.stringify({ sub: user, session_id: session, ...claims })]);
        return (await tx.query(sql, params)).rows;
      });
    }
    async function register(sql, params) {
      return db.transaction(async tx => {
        await tx.exec("set local role service_role");
        return (await tx.query(sql, params)).rows[0].ok;
      });
    }
    const google = "select register_admin_session($1,$2,$3) as ok";
    const vendorSignIn = "select register_vendor_session($1,$2,'vendor@example.test') as ok";
    const permissions = "select campusbite_owner_state() as owner, campusbite_is_admin() as admin, campusbite_vendor_session() as vendor";
    const denied = { owner: "denied", admin: false, vendor: false };
    const totp = { aal: "aal2", amr: [{ method: "oauth" }, { method: "totp" }] };
    for (const role of ["anon","authenticated"]) {
      const privileges = (await db.query(`select
        has_function_privilege($1,'register_admin_session(uuid,uuid,text)','execute') as admin,
        has_function_privilege($1,'register_vendor_session(uuid,uuid,text,text)','execute') as vendor,
        has_function_privilege($1,'confirm_vendor_password_setup(uuid,uuid,text)','execute') as password_setup,
        has_table_privilege($1,'campusbite_private.admin_sessions','insert') as insert_admin,
        has_table_privilege($1,'campusbite_private.vendor_sessions','insert') as insert_vendor`, [role])).rows[0];
      assert.deepEqual(privileges, { admin: false, vendor: false, password_setup: false, insert_admin: false, insert_vendor: false });
    }
    assert.equal(await register(google, [previousAdmin, admin, "other-sub"]), false);
    assert.deepEqual((await portal(admin, previousAdmin, permissions, [], totp))[0], denied);
    assert.deepEqual(await portal(admin, previousAdmin, "select id from vendor_applications"), []);
    assert.equal(await register(google, [ownerLogin, owner, "owner-sub"]), false);
    await db.query("update auth.identities set identity_data=$1 where user_id=$2", [{ email: ownerEmail, email_verified: true }, owner]);
    assert.equal(await register(google, [ownerLogin, owner, "other-sub"]), false);
    assert.equal(await register(google, [previousAdmin, owner, "owner-sub"]), false);
    assert.equal(await register(google, [ownerLogin, owner, "owner-sub"]), true);
    assert.equal(await register(google, [ownerLogin, owner, "owner-sub"]), true);
    const challenge = { owner: "challenge", admin: false, vendor: false };
    assert.deepEqual((await portal(owner, ownerLogin, permissions))[0], challenge);
    assert.deepEqual(await portal(owner, ownerLogin, "select id from vendor_applications"), []);
    assert.deepEqual((await portal(owner, ownerLogin, permissions, [], totp))[0], challenge);
    await db.query("insert into auth.mfa_factors values($1,'verified','totp')", [owner]);
    assert.deepEqual((await portal(owner, ownerLogin, permissions, [], { aal: "aal2", amr: [{ method: "phone" }] }))[0], challenge);
    assert.deepEqual((await portal(owner, ownerLogin, permissions, [], totp))[0], { owner: "granted", admin: true, vendor: false });
    assert.ok((await portal(owner, ownerLogin, "select id from vendor_applications", [], totp)).length);
    const notificationOrder = (await db.query("select id from commerce_orders where provider_payment='pay_New'")).rows[0].id;
    for (const [endpoint, email, login] of [["owner-endpoint",ownerEmail,ownerLogin],["legacy-endpoint",ownerEmail,null],["previous-endpoint","admin@example.test",previousAdmin]]) {
      await db.query("insert into push_subscriptions(endpoint,keys,audience,email,staff_session_id) values($1,'{}','admin',$2,$3)",[endpoint,email,login]);
      await db.query("insert into campusbite_private.push_jobs(endpoint,order_id,topic,body) values($1,$2,'exception','Fixture notification')",[endpoint,notificationOrder]);
    }
    const recipients = await db.query("select endpoint from claim_order_push() where audience='admin'");
    assert.deepEqual(recipients.rows,[{endpoint:"owner-endpoint"}]);
    assert.deepEqual((await portal(owner, ordinaryLogin, permissions, [], totp))[0], denied);
    assert.deepEqual((await portal(vendor, applicantLogin, permissions))[0], denied);
    assert.deepEqual(await portal(vendor, applicantLogin, "select shop_id from vendor_access"), []);
    assert.equal(await register(vendorSignIn, [vendorLogin, owner]), false);
    assert.equal(await register(vendorSignIn, [vendorLogin, vendor]), false);
    assert.equal(await register("select register_vendor_session($1,$2,'vendor@example.test','other-sub') as ok",[vendorLogin,vendor]),false);
    await db.query("insert into auth.identities values($1,'google','vendor-sub',$2)",[vendor,{email:"vendor@example.test",email_verified:true}]);
    assert.equal(await register("select register_vendor_session($1,$2,'vendor@example.test','vendor-sub') as ok",[vendorLogin,vendor]),true);
    assert.equal((await portal(vendor,vendorLogin,permissions))[0].vendor,true);
    await portal(vendor,vendorLogin,"select end_staff_session()");
    assert.deepEqual((await portal(vendor,vendorLogin,permissions))[0],denied);
    assert.equal(await register("select confirm_vendor_password_setup($1,$2,'vendor@example.test') as ok",[applicantLogin,vendor]),true);
    assert.deepEqual((await portal(vendor, applicantLogin, permissions))[0], denied);
    assert.equal(await register(vendorSignIn, [vendorLogin, vendor]), true);
    assert.deepEqual((await portal(vendor, vendorLogin, permissions, [], totp))[0], { ...denied, vendor: true });
    assert.deepEqual(await portal(vendor, vendorLogin, "select shop_id from vendor_access"), [{ shop_id: shop }]);
    const otherShop = (await db.query("select id from vendor_shops where id<>$1 limit 1",[shop])).rows[0].id;
    await assert.rejects(portal(vendor, vendorLogin, "select vendor_order_feed($1)", [otherShop]));
    await db.query("delete from vendor_access where shop_id=$1 and email='vendor@example.test'", [shop]);
    assert.deepEqual((await portal(vendor, vendorLogin, permissions))[0], denied);
    await db.query("update auth.identities set identity_data=$1 where user_id=$2", [{ email: "changed@example.test", email_verified: true }, owner]);
    assert.deepEqual((await portal(owner, ownerLogin, permissions, [], totp))[0], denied);
    await db.query("update auth.identities set identity_data=$1 where user_id=$2", [{ email: ownerEmail, email_verified: true }, owner]);
    await portal(owner, ordinaryLogin, "select end_staff_session()");
    assert.equal((await portal(owner, ownerLogin, permissions, [], totp))[0].admin,true);
    await portal(owner, ownerLogin, "select end_staff_session()");
    assert.deepEqual((await portal(owner, ownerLogin, permissions, [], totp))[0], denied);
    assert.equal(await register(google, [ownerLogin, owner, "owner-sub"]), true);
    await db.query("delete from auth.sessions where id=$1",[ownerLogin]);
    assert.deepEqual((await portal(owner, ownerLogin, permissions, [], totp))[0], denied);
    await db.query("insert into campusbite_private.push_jobs(endpoint,order_id,topic,body) values('owner-endpoint',$1,'exception','Another notification')",[notificationOrder]);
    assert.deepEqual((await db.query("select endpoint from claim_order_push() where audience='admin'")).rows,[]);
  });
});
