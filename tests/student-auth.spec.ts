import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3109" });

test("public requests have browser protections and bounded bodies", async ({ request }) => {
  const page = await request.get("/auth/student/callback", { maxRedirects: 0 });
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  const home = await request.get("http://127.0.0.1:3108/");
  expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  for (const path of ["/api/reviews", "/api/pickup-availability"]) {
    const response = await request.post(path, { data: { comment: "a".repeat(8192) } });
    expect(response.status()).toBe(413);
  }
});

test("reviews verify the challenge before charging the client and site quotas", async ({ request }) => {
  const review = { name: "Visitor", rating: 4, comment: "Good pickup." };
  let granted = true;
  let writes = 0;
  const calls: { p_bucket: string; p_key_hash: string }[] = [];
  const headers = { "x-real-ip": "192.0.2.1" };
  const fixture = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    res.setHeader("content-type", "application/json");
    if (path.endsWith("/rpc/campusbite_consume_attempt")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      calls.push(JSON.parse(raw));
      return res.end(JSON.stringify(granted));
    }
    if (path.endsWith("/campus_reviews") && req.method === "POST") {
      writes++;
      return res.end(JSON.stringify({ ...review, id: "fixture", createdAt: new Date().toISOString() }));
    }
    return res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve, reject) => fixture.once("error", reject).listen(3110, "127.0.0.1", resolve));
  try {
    for (const challenge of [undefined, "signup-fixture", "other-host-fixture"]) {
      expect((await request.post("/api/reviews", { headers, data: { ...review, challenge } })).status()).toBe(403);
    }
    expect(writes).toBe(0);
    expect(calls).toHaveLength(0);
    const data = { ...review, challenge: "review-fixture" };
    expect((await request.post("/api/reviews", { headers, data })).status()).toBe(201);
    expect((await request.post("/api/reviews", { headers: { "x-real-ip": "192.0.2.2" }, data })).status()).toBe(201);
    expect((await request.post("/api/reviews", { data })).status()).toBe(201);
    expect(calls.map(c=>c.p_bucket)).toEqual(["public-reviews-network","public-reviews-total","public-reviews-network","public-reviews-total","public-reviews-total"]);
    expect(calls[0].p_key_hash).not.toBe(calls[2].p_key_hash);
    granted = false;
    expect((await request.post("/api/reviews", { headers, data })).status()).toBe(429);
    expect(writes).toBe(3);
  } finally { await new Promise<void>(resolve => fixture.close(() => resolve())); }
});

test("signup passes form verification before requesting an email", async ({page}) => {
  let signups = 0;
  const quotas: string[] = [];
  const fixture = createServer(async (req,res) => {
    res.setHeader("content-type","application/json");
    const path = new URL(req.url!, "http://localhost").pathname;
    if (path.endsWith("/rpc/campusbite_consume_attempt")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      quotas.push(JSON.parse(raw).p_bucket);
      return res.end("true");
    }
    if (path === "/auth/v1/signup") {
      signups++;
      return res.end(JSON.stringify({ id:"00000000-0000-4000-8000-000000000508", email:"new@example.test" }));
    }
    return res.end("[]");
  });
  await new Promise<void>((resolve,reject)=>fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    await page.route("https://challenges.cloudflare.com/turnstile/**", route=>route.fulfill({
      contentType:"application/javascript", body:`window.turnstile = {
        render(element, options) {
          const field = document.createElement("input");
          field.name = "cf-turnstile-response";
          field.setAttribute("aria-label", "Fixture verification");
          element.append(field);
          return "widget";
        },
        remove() {}
      }`,
    }));
    await page.setExtraHTTPHeaders({ "x-real-ip": "192.0.2.3" });
    await page.goto("/sign-in");
    await page.getByRole("button",{ name:"Create account" }).click();
    await page.getByLabel("Display name").fill("Campus Student");
    await page.getByLabel("Email",{exact:true}).fill("new@example.test");
    await page.getByLabel("Password",{exact:true}).fill("fixture-password");
    await page.getByLabel("Confirm password").fill("fixture-password");
    await page.getByRole("button",{name:"Create account"}).click();
    await expect(page.getByText("Complete the verification and try creating your account again.")).toBeVisible();
    expect(signups).toBe(0);
    expect(quotas).toEqual([]);
    await page.getByLabel("Fixture verification").fill("signup-fixture");
    await page.getByRole("button",{name:"Create account"}).click();
    await expect(page.getByRole("heading",{name:"Confirm your email"})).toBeVisible();
    expect(signups).toBe(1);
    expect(quotas).toEqual(["student-sign-up-network","student-sign-up"]);
  } finally { await new Promise<void>(resolve=>fixture.close(()=>resolve())); }
});

test("a signed capture webhook verifies the provider payment before recording its event", async ({ request }) => {
  const events: unknown[] = [];
  const queued = new Set<string>();
  const fixture = createServer(async (req,res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    res.setHeader("Content-Type","application/json");
    if (path === "/rest/v1/razorpay_environment") return res.end(JSON.stringify({mode:"test"}));
    if (path === "/rest/v1/payment_webhook_queue") {
      if (req.method==="POST") {
        let body="";
        for await (const chunk of req) body+=chunk;
        const entry=JSON.parse(body);
        if (queued.has(entry.event_id)) return res.end("[]");
        queued.add(entry.event_id);
        return res.end(JSON.stringify([entry]));
      }
      return res.end(JSON.stringify([]));
    }
    if (path === "/rest/v1/commerce_orders") return res.end(JSON.stringify({provider_payment:null,amount_paise:100}));
    if (path === "/rest/v1/rpc/commerce_apply_razorpay_event") {
      let body = "";
      for await (const chunk of req) body += chunk;
      events.push(JSON.parse(body));
      return res.end("true");
    }
    return res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve,reject) => fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    const data = JSON.stringify({event:"payment.captured",payload:{payment:{entity:{
      id:"pay_Captured",order_id:"order_Fixture",status:"captured",amount:100,currency:"INR",
    }}}});
    const response = await request.post("/api/payments/razorpay",{data,headers:{
      "x-razorpay-signature":createHmac("sha256","payment-webhook-fixture").update(data).digest("hex"),
      "x-razorpay-event-id":"fixture-delivery",
    }});
    expect(response.status()).toBe(204);
    const retry = await request.post("/api/payments/razorpay", {data, headers: {
      "x-razorpay-signature": createHmac("sha256","payment-webhook-fixture").update(data).digest("hex"),
    }});
    expect(retry.status()).toBe(204);
    expect(events).toEqual([{event_id:"entity:test:payment.captured:pay_Captured",kind:"payment.captured",payment_id:"pay_Captured",
      gateway_order:"order_Fixture",amount:100,currency:"INR",key_mode:"test"}]);
    for (const suffix of ["Partial","Split"]) {
      const data = JSON.stringify({event:"refund.processed",payload:{refund:{entity:{
        id:"rfnd_"+suffix,payment_id:"pay_"+suffix,status:"processed",amount:40,currency:"INR",
      }}}});
      const response=await request.post("/api/payments/razorpay",{data,headers:{
        "x-razorpay-signature":createHmac("sha256","payment-webhook-fixture").update(data).digest("hex"),
      }});
      expect(response.status()).toBe(suffix==="Split" ? 204 : 202);
    }
    expect(events.slice(1)).toEqual([{event_id:"entity:test:refund.processed:rfnd_Split",kind:"refund.processed",
      payment_id:"pay_Split",gateway_order:null,amount:100,currency:"INR",key_mode:"test"}]);
  } finally {
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});

test("the scheduled worker recovers a captured payment after the browser closes",async({request})=>{
  const order="00000000-0000-4000-8000-000000000099";
  const attempts:unknown[]=[];
  const captures:unknown[]=[];
  const runs:unknown[]=[];
  const fixture=createServer(async(req,res)=>{
    const path=new URL(req.url!,"http://localhost").pathname;
    let raw="";
    for await(const chunk of req) raw+=chunk;
    const body=raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type","application/json");
    if (path==="/rest/v1/razorpay_environment") return res.end(JSON.stringify({mode:"test"}));
    if (path==="/rest/v1/commerce_worker_runs") {
      if (req.method==="POST") return res.end(JSON.stringify({id:order}));
      runs.push(body); return res.writeHead(204).end();
    }
    if (path==="/rest/v1/rpc/claim_payment_recovery") return res.end(JSON.stringify([{id:order,provider_order:"order_Fixture",amount_paise:100}]));
    if (path==="/rest/v1/commerce_payment_attempts") {attempts.push(body); return res.writeHead(201).end();}
    if (path==="/rest/v1/rpc/commerce_apply_razorpay_event") {captures.push(body); return res.end("true");}
    if (path==="/rest/v1/commerce_orders" && req.method==="PATCH") return res.writeHead(204).end();
    if (path==="/rest/v1/rpc/expire_uncollected") return res.writeHead(204).end();
    if (["commerce_refund_jobs","claim_order_push","claim_payment_webhooks"].some(name=>path==="/rest/v1/rpc/"+name)) return res.end("[]");
    return res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve,reject)=>fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    expect((await request.post("/api/jobs/commerce")).status()).toBe(401);
    const response=await request.post("/api/jobs/commerce",{headers:{authorization:"Bearer worker-fixture"}});
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({paymentRetries:0,webhookRetries:0});
    expect(attempts).toEqual([expect.objectContaining({payment_id:"pay_Recovered",order_id:order,status:"captured"})]);
    expect(captures).toEqual([expect.objectContaining({event_id:"recovery:pay_Recovered",gateway_order:"order_Fixture",amount:100,key_mode:"test"})]);
    expect(runs).toEqual([expect.objectContaining({outcome:"ok"})]);
  } finally {await new Promise<void>(resolve=>fixture.close(()=>resolve()));}
});

test("admin test checkout confirms capture and distinguishes authorization", async ({ page, context }) => {
  const user = { id:"00000000-0000-4000-8000-000000000085", email:"tyagiaayush3030@gmail.com", email_confirmed_at:"2026-11-19T00:00:00Z" };
  const fixture = createServer((req,res) => {
    res.setHeader("Content-Type","application/json");
    if (req.url === "/auth/v1/user") return res.end(JSON.stringify(user));
    if (req.url === "/rest/v1/rpc/campusbite_owner_state") return res.end('"granted"');
    if (req.url === "/rest/v1/rpc/campusbite_consume_attempt") return res.end("true");
    return res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve,reject) => fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    const session = { access_token:"local-admin-token",refresh_token:"local-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user };
    await context.addCookies([{ name:"campusbite-staff",value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url:"http://127.0.0.1:3109" }]);
    for (const payment of ["pay_Authorized","pay_Captured"]) {
      const signature = createHmac("sha256","admin-payment-fixture").update("order_Fixture|"+payment).digest("hex");
      await page.route("https://checkout.razorpay.com/v1/checkout.js", route => route.fulfill({
        contentType:"text/javascript", body:`window.Razorpay = class { constructor(options){ this.options = options } open(){ this.options.handler(${JSON.stringify({razorpay_payment_id:payment,razorpay_signature:signature})}) } };`,
      }));
      await page.goto("/admin/payment-test");
      await page.getByRole("button",{name:"Test ₹1 payment"}).click();
      await expect(page.getByRole("status")).toContainText(payment === "pay_Captured" ? "Verified ₹1 test payment" : "Capture is unconfirmed");
      await page.unroute("https://checkout.razorpay.com/v1/checkout.js");
    }
  } finally {
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});

test("shared Supabase Auth uses the deployed student callback and remembers checkout", async ({ page, context }) => {
  await page.route("http://127.0.0.1:3110/auth/v1/authorize**", route => route.fulfill({ body: "Test provider" }));
  await page.goto("/sign-in?returnTo=checkout");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL("http://127.0.0.1:3110/auth/v1/authorize**");
  const query = new URL(page.url()).searchParams;
  expect(query.get("redirect_to")).toBe("https://campusbite-lpu.vercel.app/auth/student/callback");
  expect(query.get("code_challenge")).toBeTruthy();
  const cookies = await context.cookies("http://127.0.0.1:3109/auth/student/callback");
  expect(cookies.find(cookie => cookie.name === "campusbite-student-return")).toMatchObject({
    value: encodeURIComponent("/checkout"), httpOnly: true, secure: true, sameSite: "Lax",
  });
  const provider = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/auth/v1/token?grant_type=pkce") {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      access_token: "fixture-access-token", refresh_token: "fixture-refresh-token", token_type: "bearer",
      expires_in: 3600, user: { id: "00000000-0000-4000-8000-000000000001", email: "student@example.test" },
    }));
  });
  await new Promise<void>((resolve, reject) => provider.once("error", reject).listen(3110, "127.0.0.1", resolve));
  try {
    const callback = await page.request.get("/auth/student/callback?code=fixture", { maxRedirects: 0 });
    expect(callback.status()).toBe(303);
    expect(callback.headers().location).toBe("/checkout");
    expect((await context.cookies()).some(cookie => cookie.name === "campusbite-student-return")).toBe(false);
  } finally {
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});

test("an incomplete student callback returns to sign-in on the same host", async ({ request }) => {
  const response = await request.get("/auth/student/callback", { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe("/sign-in?error=google");
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("an applicant saves and reopens a draft, attaches a PDF, and submits the same application", async ({page, context}) => {
  const user = { id: "00000000-0000-4000-8000-000000000071", email: "owner@example.test", email_confirmed_at: "2026-11-19T00:00:00Z" };
  let application: Record<string, unknown> | undefined;
  const uploaded = new Set<string>();
  const fixture = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/auth/v1/user") return res.end(JSON.stringify(user));
    if (url.pathname === "/rest/v1/rpc/campusbite_consume_attempt") return res.end("true");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (url.pathname.startsWith("/storage/v1/object/vendor-onboarding/") && req.method === "POST") {
      uploaded.add(url.pathname);
      return res.end(JSON.stringify({ Key: url.pathname }));
    }
    if (url.pathname === "/rest/v1/vendor_applications") {
      if (req.method === "POST") {
        application = { documents: [], review_note: "", created_at: user.email_confirmed_at, ...JSON.parse(raw) };
      } else {
        if (url.searchParams.get("email") !== "eq." + user.email) return res.writeHead(403).end();
        if (req.method === "PATCH") {
          if (!application || url.searchParams.get("revision") !== "eq." + application.revision) return res.end("[]");
          Object.assign(application, JSON.parse(raw));
        }
      }
      const rows = application ? [application] : [];
      return res.end(JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? application ?? null : rows));
    }
    return res.end("[]");
  });
  await new Promise<void>((resolve,reject) => fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    const session = { access_token:"local-applicant-token",refresh_token:"local-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user };
    await context.addCookies([{ name:"campusbite-student-auth", value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"), url:"http://127.0.0.1:3109" }]);
    await page.goto("/vendor/onboarding");
    await page.getByRole("link",{name:"New application"}).click();
    await page.getByLabel("Shop name",{exact:true}).fill("Fourth Kitchen");
    await page.getByRole("button",{name:"Save draft"}).click();
    await expect(page.getByRole("heading",{name:"Fourth Kitchen"})).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Shop name",{exact:true})).toHaveValue("Fourth Kitchen");
    await page.getByLabel("Registration or supporting PDF").setInputFiles({ name:"registration.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n") });
    await page.getByRole("button",{name:"Upload document"}).click();
    await expect(page.getByRole("link",{name:"registration.pdf"})).toBeVisible();
    expect(uploaded.size).toBe(1);
    await page.getByLabel("Owner or contact name").fill("Shop owner");
    await page.getByLabel("Phone number").fill("9876543210");
    await page.getByRole("combobox",{name:"Food court",exact:true}).selectOption("block-41");
    await page.getByLabel("Exact stall location").fill("Stall 4");
    await page.getByLabel("Cuisine").fill("Snacks");
    await page.getByLabel("Opens (IST)",{exact:true}).fill("09:00");
    await page.getByLabel("Closes (IST)",{exact:true}).fill("18:00");
    await page.getByLabel("Food registration number").fill("Pilot registration");
    await page.getByLabel("I accept the pilot vendor agreement").check();
    await page.getByRole("button",{name:"Submit for review"}).click();
    await expect(page.getByRole("heading",{name:"Application details"})).toBeVisible();
    await expect(page.getByText("Submitted",{exact:true})).toBeVisible();
    expect(application?.agreement_version).toBe("pilot-v1");
    expect(application?.email).toBe(user.email);
  } finally {
    await new Promise<void>(resolve=>fixture.close(()=>resolve()));
  }
});

test("admin publishes a new shop from Current Vendors and its public menu opens", async ({ page, context }) => {
  const shop = { id:"00000000-0000-4000-8000-000000000081", name:"Campus Dosa", created_at:"2026-11-19T00:00:00Z" };
  const user = { id:"00000000-0000-4000-8000-000000000082",email:"tyagiaayush3030@gmail.com",email_confirmed_at:shop.created_at };
  let listing: Record<string,unknown> | undefined;
  const fixture = createServer(async (req,res) => {
    const url = new URL(req.url!,"http://localhost");
    res.setHeader("Content-Type","application/json");
    if (url.pathname === "/auth/v1/user") return res.end(JSON.stringify(user));
    if (url.pathname === "/rest/v1/rpc/campusbite_owner_state") return res.end('"granted"');
    if (url.pathname === "/rest/v1/rpc/save_vendor_storefront") {
      let raw="";
      for await (const chunk of req) raw+=chunk;
      const body=JSON.parse(raw);
      if (body.target_shop!==shop.id || body.expected_revision!==-1) return res.writeHead(409).end();
      listing={...body.details,shop_id:shop.id,revision:1,photo:""};
      return res.end();
    }
    let rows: unknown[]=[];
    if (url.pathname === "/rest/v1/vendor_shops") rows=[shop];
    if (url.pathname === "/rest/v1/commerce_stalls" && listing && url.searchParams.get("shop_id")!=="is.null") rows=[listing];
    res.setHeader("Content-Range","*/"+rows.length);
    return res.end(JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows));
  });
  await new Promise<void>((resolve,reject)=>fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    const session={access_token:"local-admin-token",refresh_token:"local-refresh",expires_at:Math.floor(Date.now()/1000)+3600,user};
    await context.addCookies([{name:"campusbite-staff",value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url:"http://127.0.0.1:3109"}]);
    await page.goto("/admin/vendors");
    await page.getByRole("link",{name:/Campus Dosa/}).click();
    await expect(page.getByRole("heading",{name:"Campus Dosa"})).toBeVisible();
    await page.getByRole("combobox",{name:"Food court",exact:true}).selectOption("block-41");
    await page.getByLabel("Exact location").fill("Block 41 counter 3");
    await page.getByLabel("Cuisine").fill("South Indian");
    await page.getByLabel("Opens (IST)").fill("08:00");
    await page.getByLabel("Closes (IST)").fill("20:00");
    await page.getByLabel("Publish in the student directory").check();
    await page.getByRole("button",{name:"Save storefront"}).click();
    await page.getByRole("link",{name:"Open public storefront"}).click();
    await expect(page).toHaveURL(/\/stalls\/campus-dosa$/);
    await expect(page.getByRole("heading",{name:"Campus Dosa"})).toBeVisible();
    await expect(page.getByText("Block 41 counter 3",{exact:true})).toBeVisible();
    expect(listing?.enabled).toBe(false);
  } finally {
    await new Promise<void>(resolve=>fixture.close(()=>resolve()));
  }
});

test("admin navigation keeps the current workspace visible during a slow shop query", async ({ page, context }) => {
  const user = { id: "00000000-0000-4000-8000-000000000002", email: "tyagiaayush3030@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  let releaseShops = () => {};
  const holdShops = new Promise<void>(resolve => { releaseShops = resolve; });
  let waiting = false;
  const firstShop = { id: "00000000-0000-4000-8000-000000000010", name: "First kitchen", created_at: user.email_confirmed_at };
  const newShop = { ...firstShop, id: "00000000-0000-4000-8000-000000000020", name: "Second kitchen" };
  const shops = [firstShop];
  const grants: { shop_id: string; email: string; role: string }[] = [];
  const fixture = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    res.setHeader("Content-Type", "application/json");
    if (path === "/auth/v1/user") return res.end(JSON.stringify(user));
    if (path === "/rest/v1/rpc/campusbite_owner_state") return res.end('"granted"');
    const query = new URL(req.url!, "http://localhost").searchParams;
    let body = "";
    for await (const chunk of req) body += chunk;
    if (path === "/rest/v1/vendor_shops" && req.method === "POST") {
      shops.push(newShop);
      return res.end(JSON.stringify({ id: newShop.id }));
    }
    if (path === "/rest/v1/vendor_shops" && req.method === "GET") {
      waiting = true;
      await holdShops;
      const id = query.get("id");
      return res.end(JSON.stringify(id ? shops.filter(shop => id === "eq." + shop.id) : shops));
    }
    if (path === "/rest/v1/rpc/campusbite_grant_vendor_access") {
      const { p_shop_id, p_email, p_role } = JSON.parse(body);
      grants.push({ shop_id: p_shop_id, email: p_email, role: p_role });
      return res.end();
    }
    if (path === "/rest/v1/vendor_access") {
      const rows = grants.filter(g => "eq." + g.shop_id === query.get("shop_id"));
      if (req.method === "PATCH") {
        const target = rows.find(g => "eq." + g.email === query.get("email") && "eq." + g.role === query.get("role"));
        if (target) target.role = JSON.parse(body).role;
        return res.end(JSON.stringify(target ? [target] : []));
      }
      return res.end(JSON.stringify(rows));
    }
    res.setHeader("Content-Range", "*/0");
    res.end("[]");
  });
  await new Promise<void>((resolve, reject) => fixture.once("error", reject).listen(3110, "127.0.0.1", resolve));
  try {
    const session = { access_token: "local-test-token", refresh_token: "local-test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user };
    await context.addCookies([{ name: "campusbite-staff", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: "http://127.0.0.1:3109" }]);
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Admin navigation" });
    await nav.getByRole("link", { name: "Access Management" }).click();
    await expect.poll(() => waiting).toBe(true);
    await expect(nav).toBeVisible();
    await expect(page.getByRole("heading", { name: "CampusBite Admin" })).toBeVisible();
    releaseShops();
    await expect(page.getByRole("heading", { name: "Access Management" })).toBeVisible();
    await expect(page.getByLabel("Approved email")).toHaveCount(0);
    await page.getByRole("button", { name: "Select shop First kitchen" }).click();
    await expect(page.getByRole("heading", { name: "Grant access to First kitchen" })).toBeVisible();
    await page.getByLabel("Vendor shop name").fill(newShop.name);
    await page.getByRole("button", { name: "Create shop" }).click();
    await expect(page.getByRole("heading", { name: "Grant access to Second kitchen" })).toBeVisible();
    const email = "member@example.test";
    await page.getByLabel("Approved email").fill(email);
    await page.getByRole("button", { name: "Grant access to Second kitchen" }).click();
    const memberRole = page.getByLabel(`Role for ${email}`);
    await expect(memberRole).toHaveValue("staff");
    await memberRole.selectOption("manager");
    await page.getByRole("button", { name: "Change role" }).click();
    await expect.poll(() => grants).toEqual([{ shop_id: newShop.id, email, role: "manager" }]);
    await page.getByRole("button", { name: "Select shop First kitchen" }).click();
    await expect(page.getByRole("heading", { name: "People with access to First kitchen" })).toBeVisible();
    await expect(memberRole).toHaveCount(0);
  } finally {
    releaseShops();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});
