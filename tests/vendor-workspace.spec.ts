import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { pickupSlots, type Stall } from "../src/lib/campus";
import { expect, test } from "@playwright/test";

test.use({baseURL:"http://127.0.0.1:3109"});

test("student pickup choices follow IST weekdays, specific closures and historic window overlaps",()=>{
  const stall:Stall = {id:"shop",name:"Cafe",photo:"",location:"Campus",cuisine:"Snacks",approval:"Approved",paused:false,
    opening:"09:00",closing:"18:00",capacity:1,pickupMinutes:15,weeklyHours:{Saturday:{opens:"10:05",closes:"11:00"},Sunday:null}};
  const time=(s:string)=>Date.parse(s+"+05:30");
  const lines=[{prep:4,qty:1}];
  const saturday=time("2027-02-13T10:04");
  const windows=pickupSlots(stall,lines,[],saturday);
  expect(windows.map(w=>w.start)).toEqual([time("2027-02-13T10:20"),time("2027-02-13T10:35")]);
  expect(windows[0].end-windows[0].start).toBe(15*60000);
  const previous={stall:"shop",status:"accepted" as const,deadline:0,slot:{start:time("2027-02-13T10:15"),end:time("2027-02-13T10:25")}};
  expect(pickupSlots(stall,lines,[previous],saturday)).toEqual(windows.slice(1));
  expect(pickupSlots(stall,lines,[],time("2027-02-14T10:00"))).toEqual([]);
  expect(pickupSlots({...stall,closedDates:["2027-02-13"]},lines,[],saturday)).toEqual([]);
  expect(pickupSlots({...stall,weeklyHours:{Saturday:null,Sunday:{opens:"00:05",closes:"01:00"}}},lines,[],time("2027-02-13T23:45"))[0].start).toBe(time("2027-02-14T00:05"));
});

test("vendor staff can refresh and act on a shop order, and managers can edit the shop",async ({page,context})=>{
  const shop="00000000-0000-4000-8000-000000000501", id="00000000-0000-4000-8000-000000000503";
  const user={id:"00000000-0000-4000-8000-000000000502",email:"vendor@example.test",email_confirmed_at:new Date().toISOString()};
  const student={id:randomUUID(),email:"student@example.test",email_confirmed_at:new Date().toISOString()};
  type Reservation = { id:string; fingerprint:string; status:string; reserved_until:string; provider_order:string|null; provider_payment:string|null; amount_paise:number };
  const reservations = new Map<string,Reservation>();
  let studentCaptures=0;
  let role="manager", blocked=false, registered=false;
  const store={slug:"test-shop",display_name:"Campus Kitchen",court:"unimall",location:"Test counter",photo:"",cuisine:"Tea",shop_id:shop,opens:"09:00",closes:"17:00",capacity:3,basket_limit:8,closed_dates:[],vendor_paused:false,revision:0,
    menu_categories:["Meals","Wraps","Drinks","Snacks"],weekly_hours:{},pickup_minutes:10,enabled:true,published:true,standing:"approved",payment_status:"verified"};
  const order={id,shop_id:shop,reference:"CB-WORKSHOP",status:"awaiting",pickup_at:new Date(Date.now()+1800000).toISOString(),
    items:[{name:"Mint wrap",qty:1,price:6200}],preparation_note:"Less chilli",accept_until:new Date(Date.now()+90000).toISOString(),
    prep_minutes:8,amount_paise:6200,rejection_reason:"",refund:"None",events:[{status:"Payment captured",at:Date.now()}]};
  const menu:Record<string,unknown>[]=[];
  const availableStart = Math.ceil((Date.now()+30*60000)/60000)*60000;
  let availableSlots = [{start:availableStart,end:availableStart+15*60000}];
  let availabilityDown = false;
  let incoming:typeof order|undefined;
  let notify:()=>void = ()=>{};
  let subscription:Record<string,string>|undefined;
  const fixture=createServer(async(req,res)=>{
    const url=new URL(req.url!,"http://localhost");
    let raw=""; for await(const chunk of req) raw+=chunk;
    const body=raw && req.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : {};
    res.setHeader("Content-Type","application/json");
    const rows=(items:unknown[])=>res.end(JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? items[0] ?? null : items));
    switch(url.pathname) {
      case "/auth/v1/user": return res.end(JSON.stringify(req.headers.authorization==="Bearer local-student" ? student : user));
      case "/rest/v1/rpc/campusbite_vendor_session": return res.end(JSON.stringify(registered));
      case "/rest/v1/vendor_access": return rows([{role,email:user.email,shop_id:shop,created_at:user.email_confirmed_at}]);
      case "/rest/v1/vendor_shops": return rows([{id:shop,name:"Campus Kitchen"}]);
      case "/rest/v1/commerce_stalls": return rows([store]);
      case "/rest/v1/commerce_menu": return rows(menu);
      case "/rest/v1/vendor_sales": return rows([]);
      case "/rest/v1/rpc/campusbite_consume_attempt": return res.end(JSON.stringify(["pickup-availability-shop","student-checkout"].includes(body.p_bucket)));
      case "/rest/v1/razorpay_environment": return rows([{mode:"test"}]);
      case "/rest/v1/ordering_control": return rows([{paused:false}]);
      case "/rest/v1/rpc/commerce_reserve": {
        if (body.actor!==student.id || body.amount!==3000 || body.stall!==store.slug) return res.writeHead(400).end("{}");
        const reservation={id:randomUUID(),fingerprint:body.signature,status:reservations.size===0 ? "expired" : "unpaid",
          reserved_until:new Date(Date.now()+300_000).toISOString(),provider_order:null,provider_payment:null,amount_paise:body.amount};
        reservations.set(body.request,reservation);
        return res.end(JSON.stringify(reservation));
      }
      case "/rest/v1/commerce_orders": {
        const request=url.searchParams.get("request_id")?.slice(3);
        const id=url.searchParams.get("id")?.slice(3);
        const reservation=request ? reservations.get(request) : Array.from(reservations.values()).find(r=>r.id===id);
        if (req.method==="PATCH" && reservation) reservation.provider_order=body.provider_order;
        return rows(reservation ? [reservation] : []);
      }
      case "/rest/v1/rpc/commerce_apply_razorpay_event":
        if (body.kind!=="payment.captured" || body.payment_id!=="pay_CapturedTea" || body.gateway_order!=="order_Fixture" ||
          body.amount!==3000 || body.currency!=="INR" || body.key_mode!=="test") return res.end("false");
        studentCaptures++;
        return res.end("true");
      case "/rest/v1/rpc/commerce_pickup_availability":
        if (availabilityDown) return res.writeHead(503).end("{}");
        if (body.stall!=="test-shop" || body.items?.[0]?.qty!==1 || body.items?.[0]?.price!==3000) return res.writeHead(400).end("{}");
        return res.end(JSON.stringify({slots:availableSlots,message:availableSlots.length ? null : "There is not enough stock for this bag"}));
      case "/rest/v1/rpc/vendor_order_feed":
        if(blocked) return res.writeHead(503).end('{"message":"temporary outage"}');
        return rows(body.selected_order ? [order] : [order,...(incoming ? [incoming] : [])]);
      case "/rest/v1/rpc/vendor_reject_order":
        order.status="rejected"; order.rejection_reason=body.reason; order.refund="Requested"; return res.end("true");
      case "/rest/v1/rpc/vendor_application_summary": return res.end('{"status":"approved","document_count":1,"agreement_version":"pilot-v1","agreed_at":"2026-01-01"}');
      case "/rest/v1/rpc/vendor_earnings": return res.end('{"orders":1,"captured":6200,"refunded":0,"refund_pending":6200}');
      case "/rest/v1/rpc/vendor_write_item": menu.push({...body.fields,id:body.item_id,revision:0,stall_slug:store.slug}); return res.end("null");
      case "/rest/v1/rpc/vendor_save_category":
        if (body.previous_name) {
          store.menu_categories=store.menu_categories.map(c=>c===body.previous_name ? body.new_name : c);
          for (const item of menu) if (item.category===body.previous_name) item.category=body.new_name;
        } else store.menu_categories.push(body.new_name);
        return res.end("null");
      case "/rest/v1/rpc/vendor_set_schedule": store.weekly_hours=body.weekly; store.pickup_minutes=body.minutes; store.vendor_paused=body.paused; store.revision++; return res.end("null");
      default:return res.writeHead(404).end("{}");
    }
  });
  // Mirror the Realtime join and change frames used by the installed client.
  const { WebSocketServer } = require("next/dist/compiled/ws");
  const sockets = new WebSocketServer({server:fixture});
  type Socket = {send:(text:string)=>void;on:(name:string, fn:(data:Buffer)=>void)=>void;terminate:()=>void};
  sockets.on("connection",(socket:Socket)=>{
    socket.on("message",data=>{
      const [join,ref,topic,event,payload]=JSON.parse(data.toString());
      const send=(type:string,body:unknown)=>socket.send(JSON.stringify([join,ref,topic,type,body]));
      if(event==="phx_join"){
        subscription=payload.config.postgres_changes[0];
        send("phx_reply",{status:"ok",response:{postgres_changes:[{...subscription,id:1}]}});
        notify=()=>send("postgres_changes",{ids:[1],data:{type:"UPDATE",schema:"public",table:"vendor_orders",columns:[],record:{},old_record:{}}});
      } else send("phx_reply",{status:"ok",response:{}});
    });
  });
  await new Promise<void>((resolve,reject)=>fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    const session={access_token:"local-staff-token",refresh_token:"local-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user};
    await context.addCookies([{name:"campusbite-staff",value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url:"http://127.0.0.1:3109"}]);
    await page.addInitScript(()=>{ const create = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator=function(){ document.documentElement.dataset.sounds=String(Number(document.documentElement.dataset.sounds ?? 0)+1); return create.call(this); };
    });
    await page.goto("/vendor/dashboard");
    await expect(page).toHaveURL(/\/vendor\/sign-in$/);
    expect((await page.request.get("/api/vendor/shops/"+shop+"/orders")).status()).toBe(403);
    expect((await page.request.get("/api/vendor/shops/"+shop+"/events")).status()).toBe(401);
    registered=true;
    await page.goto("/vendor/dashboard");
    await expect(page.getByRole("heading",{name:"Order board"})).toBeVisible();
    await expect(page.getByText(/Accept within \d+s/)).toBeVisible();
    await expect(page.getByText(/Start by/)).toBeVisible();
    await page.getByRole("button",{name:"Enable order alerts"}).click();
    await page.getByRole("button",{name:"Test sound"}).click();
    await expect(page.getByText("Live updates",{exact:true})).toBeVisible();
    expect(subscription).toMatchObject({table:"vendor_orders",filter:"shop_id=eq."+shop});
    incoming={...order,id:"00000000-0000-4000-8000-000000000504",reference:"CB-NEW"};
    notify();
    await expect(page.getByRole("link",{name:"CB-NEW"})).toBeVisible({timeout:3000});
    await expect(page.locator("html")).toHaveAttribute("data-sounds","3");
    incoming=undefined; notify();
    await expect(page.getByRole("link",{name:"CB-NEW"})).toHaveCount(0);
    blocked=true;
    await page.getByRole("button",{name:"Refresh",exact:true}).click();
    await expect(page.getByText("Connection lost",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Accept",exact:true})).toBeDisabled();
    blocked=false;
    await page.getByRole("button",{name:"Refresh",exact:true}).click();
    await expect(page.getByRole("button",{name:"Accept",exact:true})).toBeEnabled();
    await page.getByRole("link",{name:"CB-WORKSHOP"}).click();
    await expect(page.getByRole("heading",{name:"Order activity"})).toBeVisible();
    await page.getByRole("button",{name:"Reject",exact:true}).click();
    await page.getByLabel("Reason for the student").fill("Grill under repair");
    await page.getByRole("button",{name:"Confirm rejection"}).click();
    await expect(page.getByText("Rejection reason · Grill under repair")).toBeVisible();
    await page.getByRole("link",{name:"Menu editor"}).click();
    await page.getByText("Manage categories",{exact:true}).click();
    await page.getByLabel("New category name").fill("Tea blends");
    await page.getByRole("button",{name:"Create category"}).click();
    await page.getByRole("combobox",{name:"Category",exact:true}).selectOption("Tea blends");
    await page.getByLabel("Item name").fill("Mint tea");
    await page.getByLabel(/Stock remaining/).fill("3");
    await page.getByLabel("Price (₹)").fill("30");
    await page.getByLabel("Preparation time (minutes)").fill("4");
    await page.getByLabel("Dietary label").fill("Vegetarian");
    await page.getByLabel("Description and allergens").fill("Tea with mint");
    await page.getByRole("button",{name:"Create item"}).click();
    await expect(page.getByText("Mint tea",{exact:true})).toBeVisible();
    await page.getByLabel("Tea blends category name").fill("House teas");
    await page.getByRole("button",{name:"Rename Tea blends",exact:true}).click();
    await expect(page.getByLabel("House teas category name")).toBeAttached();
    await page.getByRole("link",{name:"Availability"}).click();
    await page.getByLabel("Sunday schedule").selectOption("closed");
    await page.getByLabel("Saturday schedule").selectOption("custom");
    await page.getByLabel("Saturday opens").fill("11:05");
    await page.getByLabel("Saturday closes").fill("15:00");
    await page.getByLabel("Pickup window (minutes)").fill("15");
    await page.getByLabel("Pause new orders").check();
    await page.getByRole("button",{name:"Save availability"}).click();
    await expect(page.getByText("Availability saved.")).toBeVisible();
    expect(store.weekly_hours).toEqual({Saturday:{opens:"11:05",closes:"15:00"},Sunday:null});
    expect(store.pickup_minutes).toBe(15);
    await page.getByRole("link",{name:"Onboarding",exact:true}).click();
    await expect(page.getByText("Paused by vendor")).toBeVisible();
    await page.getByRole("link",{name:"Earnings",exact:true}).click();
    await expect(page.getByText("Pending refunds",{exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Last 30 days"}).click();
    await expect(page).toHaveURL(/period=30/);
    await page.getByRole("link",{name:"Availability"}).click();
    await page.getByLabel("Pause new orders").uncheck();
    await page.getByRole("button",{name:"Save availability"}).click();
    await expect(page.getByText("Availability saved.")).toBeVisible();
    expect(menu[0].stock_remaining).toBe(3);
    await page.goto("/stalls/test-shop");
    await expect(page.getByRole("heading",{name:"House teas"})).toBeVisible();
    await page.getByText("Weekly hours (IST)").click();
    await expect(page.getByText("11:05–15:00")).toBeVisible();
    await expect(page.getByText("Closed",{exact:true})).toBeVisible();
    await page.goto("/order-online");
    await page.getByRole("button",{name:"House teas",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Campus Kitchen"}).first()).toBeVisible();
    await page.goto("/stalls/test-shop");
    await page.getByRole("button",{name:"Add Mint tea"}).click();
    await page.goto("/checkout");
    const choices=page.getByRole("radio");
    await expect(choices).toHaveCount(1);
    await choices.first().check();
    availableSlots=[];
    await page.getByRole("button",{name:"Refresh availability"}).click();
    await expect(choices).toHaveCount(0);
    await expect(page.getByText("There is not enough stock for this bag")).toBeVisible();
    availabilityDown=true;
    await page.getByRole("button",{name:"Refresh availability"}).click();
    await expect(page.getByText(/Could not check pickup availability/)).toBeVisible();
    availableSlots=[{start:availableStart,end:availableStart+15*60000}];
    availabilityDown=false;
    await page.getByRole("button",{name:"Refresh availability"}).click();
    await expect(choices).toHaveCount(1);
    await test.step("student checkout keeps an expired bag and requires a captured payment",async()=>{
      const session={access_token:"local-student",refresh_token:"local-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user:student};
      await context.addCookies([{name:"campusbite-student-auth",value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url:"http://127.0.0.1:3109"}]);
      const replies=["pay_AuthorizedTea","pay_CapturedTea"].map(payment=>({razorpay_payment_id:payment,
        razorpay_signature:createHmac("sha256","student-payment-fixture").update("order_Fixture|"+payment).digest("hex")}));
      await page.route("https://checkout.razorpay.com/v1/checkout.js",route=>route.fulfill({contentType:"text/javascript",
        body:`const replies=${JSON.stringify(replies)}; window.Razorpay=class { constructor(options){this.options=options} open(){this.options.handler(replies.shift())} };`}));
      await page.reload();
      await choices.first().check();
      const pay=page.getByRole("button",{name:/^Pay ·/});
      await pay.click();
      await expect(page.getByText(/checkout closed without a confirmed payment/)).toBeVisible();
      await expect(page.getByText("1 × Mint tea")).toBeVisible();
      await pay.click();
      await expect(page.getByText(/Payment is awaiting confirmation/)).toBeVisible();
      expect(studentCaptures).toBe(0);
      await pay.click();
      await expect(page).toHaveURL(/\/orders$/);
      expect(studentCaptures).toBe(1);
      expect(reservations.size).toBe(2);
    });
    role="staff";
    await page.goto("/vendor/board?shop="+shop);
    await expect(page.getByRole("link",{name:"Earnings"})).toHaveCount(0);
    await page.goto("/vendor/earnings?shop="+shop);
    await expect(page.getByRole("heading",{name:"Earnings"})).toHaveCount(0);
  } finally { for(const client of sockets.clients) client.terminate(); sockets.close(); fixture.closeAllConnections(); await new Promise<void>(resolve=>fixture.close(()=>resolve())); }
});
