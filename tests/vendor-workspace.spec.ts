import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test.use({baseURL:"http://127.0.0.1:3109"});

test("vendor staff can refresh and act on a shop order, and managers can edit the shop",async ({page,context})=>{
  const shop="00000000-0000-4000-8000-000000000501", id="00000000-0000-4000-8000-000000000503";
  const user={id:"00000000-0000-4000-8000-000000000502",email:"vendor@example.test",email_confirmed_at:new Date().toISOString()};
  let role="manager", blocked=false;
  const store={slug:"test-shop",shop_id:shop,opens:"09:00",closes:"17:00",capacity:3,basket_limit:8,closed_dates:[],vendor_paused:false,revision:0,
    enabled:true,published:true,standing:"approved",payment_status:"verified"};
  const order={id,shop_id:shop,reference:"CB-WORKSHOP",status:"awaiting",pickup_at:new Date(Date.now()+1800000).toISOString(),
    items:[{name:"Mint wrap",qty:1,price:6200}],preparation_note:"Less chilli",accept_until:new Date(Date.now()+90000).toISOString(),
    prep_minutes:8,amount_paise:6200,rejection_reason:"",refund:"None",events:[{status:"Payment captured",at:Date.now()}]};
  const menu:Record<string,unknown>[]=[];
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
      case "/auth/v1/user": return res.end(JSON.stringify(user));
      case "/rest/v1/vendor_access": return rows([{role,email:user.email,shop_id:shop,created_at:user.email_confirmed_at}]);
      case "/rest/v1/vendor_shops": return rows([{id:shop,name:"Campus Kitchen"}]);
      case "/rest/v1/commerce_stalls": return rows([store]);
      case "/rest/v1/commerce_menu": return rows(menu);
      case "/rest/v1/vendor_sales": return rows([]);
      case "/rest/v1/rpc/vendor_order_feed":
        if(blocked) return res.writeHead(503).end('{"message":"temporary outage"}');
        return rows(body.selected_order ? [order] : [order,...(incoming ? [incoming] : [])]);
      case "/rest/v1/rpc/vendor_reject_order":
        order.status="rejected"; order.rejection_reason=body.reason; order.refund="Requested"; return res.end("true");
      case "/rest/v1/rpc/vendor_application_summary": return res.end('{"status":"approved","document_count":1,"agreement_version":"pilot-v1","agreed_at":"2026-01-01"}');
      case "/rest/v1/rpc/vendor_earnings": return res.end('{"orders":1,"captured":6200,"refunded":0,"refund_pending":6200}');
      case "/rest/v1/rpc/vendor_write_item": menu.push({...body.fields,id:body.item_id,revision:0,stall_slug:store.slug}); return res.end("null");
      case "/rest/v1/rpc/vendor_set_availability": store.vendor_paused=body.paused; store.revision++; return res.end("null");
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
    await page.getByLabel("Item name").fill("Mint tea");
    await page.getByLabel("Price (₹)").fill("30");
    await page.getByLabel("Preparation time (minutes)").fill("4");
    await page.getByLabel("Dietary label").fill("Vegetarian");
    await page.getByLabel("Description and allergens").fill("Tea with mint");
    await page.getByRole("button",{name:"Create item"}).click();
    await expect(page.getByText("Mint tea",{exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Availability"}).click();
    await page.getByLabel("Pause new orders").check();
    await page.getByRole("button",{name:"Save availability"}).click();
    await expect(page.getByText("Availability saved.")).toBeVisible();
    await page.getByRole("link",{name:"Onboarding",exact:true}).click();
    await expect(page.getByText("Paused by vendor")).toBeVisible();
    await page.getByRole("link",{name:"Earnings",exact:true}).click();
    await expect(page.getByText("Pending refunds",{exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Last 30 days"}).click();
    await expect(page).toHaveURL(/period=30/);
    role="staff";
    await page.goto("/vendor/board?shop="+shop);
    await expect(page.getByRole("link",{name:"Earnings"})).toHaveCount(0);
    await page.goto("/vendor/earnings?shop="+shop);
    await expect(page.getByRole("heading",{name:"Earnings"})).toHaveCount(0);
  } finally { for(const client of sockets.clients) client.terminate(); sockets.close(); fixture.closeAllConnections(); await new Promise<void>(resolve=>fixture.close(()=>resolve())); }
});
