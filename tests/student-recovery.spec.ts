import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";

test.use({ baseURL: "http://127.0.0.1:3109" });

test("student saves preferences and resets by code or by email link on a second browser", async ({ page, context, browser }) => {
  const db = new PGlite();
  await db.exec("create schema campusbite_private; create role anon; create role authenticated; create role service_role");
  await db.exec(await readFile("supabase/migrations/202611200004_student_recovery.sql", "utf8"));
  const user = { id: "00000000-0000-4000-8000-000000000087", email: "student@example.test",
    email_confirmed_at: new Date().toISOString(), user_metadata: { campusbite_name: "Student" } };
  const session = { access_token: "fixture-student-access", refresh_token: "fixture-student-refresh",
    expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: "bearer", user };
  const rpc = {
    student_request_recovery: ["email_hash","ip_hash","challenge_passed"],
    student_check_recovery: ["attempt","email_hash","lease"],
    student_finish_check: ["attempt","lease","verified_email_hash","proof_hash","sealed_token","transient"],
    student_consume_recovery: ["attempt","proof_hash"],
  };
  const tokenHash = "1".repeat(64);
  let syncedPreferences:unknown;
  let redirect = "", checks = 0, changes = 0, used = false;
  const trafficKeys: string[] = [];
  const trafficHash = (value: string) => createHmac("sha256","test-server-key").update("student-recovery/"+value).digest("hex");
  const fixture = createServer(async (req,res) => {
    res.setHeader("content-type","application/json");
    try {
      const url = new URL(req.url!, "http://localhost");
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const fn = url.pathname.split("/").pop() as keyof typeof rpc;
      if (url.pathname==="/rest/v1/push_subscriptions" && req.method==="PATCH" && url.searchParams.get("student_id")==="eq."+user.id) {
        syncedPreferences=body;
        return res.writeHead(204).end();
      }
      if (Object.hasOwn(rpc,fn)) {
        if (fn === "student_request_recovery") trafficKeys.push(body.ip_hash);
        const args = rpc[fn];
        const row = await db.query<{result:unknown}>("select public."+fn+"("+args.map((_,i)=>"$"+(i+1)).join(",")+") as result",args.map(k=>body[k]));
        return res.end(JSON.stringify(row.rows[0].result));
      }
      if (url.pathname === "/auth/v1/recover") { redirect=url.searchParams.get("redirect_to") || ""; used=false; return res.end("{}"); }
      if (url.pathname === "/auth/v1/verify") {
        checks++;
        if (!used && body.type==="recovery" && (body.token==="123456" || body.token_hash===tokenHash)) {
          used=true; return res.end(JSON.stringify(session));
        }
        return res.writeHead(403).end(JSON.stringify({code:"otp_expired",message:"Invalid or expired"}));
      }
      if (url.pathname === "/auth/v1/user") {
        if (req.method === "PUT" && body.data) Object.assign(user.user_metadata,body.data);
        if (req.method === "PUT" && body.password) changes++;
        return res.end(JSON.stringify(user));
      }
      if (url.pathname === "/auth/v1/logout" && url.searchParams.get("scope") === "global") return res.end("{}");
      if (url.pathname === "/auth/v1/logout") return res.writeHead(400).end("{}");
      return res.end("[]");
    } catch { return res.writeHead(500).end("{}"); }
  });
  await new Promise<void>((resolve,reject)=>fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  const other = await browser.newContext({baseURL:"http://127.0.0.1:3109"});
  try {
    await context.addCookies([{ name:"campusbite-student-auth", value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url:"http://127.0.0.1:3109" }]);
    await page.goto("/account");
    await page.getByLabel("Display name").fill("Campus Student");
    await page.getByLabel("Refund updates").uncheck();
    await page.getByRole("button",{name:"Save account settings"}).click();
    await expect(page.getByText("Account settings saved.")).toBeVisible();
    expect(syncedPreferences).toEqual({order_alerts:true,refund_alerts:false});
    await page.reload();
    await expect(page.getByLabel("Display name")).toHaveValue("Campus Student");
    await expect(page.getByLabel("Refund updates")).not.toBeChecked();
    await expect(page.getByLabel("Order and pickup updates")).toBeChecked();
    await page.getByRole("button",{name:"Sign out"}).click();
    await expect(page).toHaveURL(/\/sign-in\?logout=device$/);
    await expect(page.getByText(/Signed out on this device/)).toBeVisible();
    expect((await context.cookies()).some(cookie=>cookie.name.startsWith("campusbite-student-auth"))).toBe(false);
    await page.goto("/account");
    await expect(page.getByRole("link",{name:"Sign in or register"})).toBeVisible();
    const send = async () => {
      await page.goto("/recovery");
      await page.getByLabel("Email",{exact:true}).fill(user.email);
      await page.getByRole("button",{name:"Email a code"}).click();
      await expect(page.getByRole("heading",{name:"Verify your recovery code"})).toBeVisible();
      expect(redirect).toMatch(/^https:\/\/campusbite-lpu\.vercel\.app\/recovery\/[\da-f-]{36}$/);
    };
    await send();
    expect(trafficKeys).toEqual([trafficHash("network-unavailable/email/" + user.email)]);
    await page.reload();
    await expect(page.getByRole("button",{name:/Resend in/})).toBeDisabled();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button",{name:"Verify code"}).click();
    await expect(page.getByRole("heading",{name:"Set a new password"})).toBeVisible();
    await page.reload();
    await page.getByLabel("New password",{exact:true}).fill("new-password-123");
    await page.getByLabel("Confirm new password").fill("different-password");
    await page.getByRole("button",{name:"Save new password"}).click();
    await expect(page.getByText("The passwords do not match.")).toBeVisible();
    expect(changes).toBe(0);
    await page.getByLabel("Confirm new password").fill("new-password-123");
    await page.getByRole("button",{name:"Save new password"}).click();
    await expect(page.getByRole("heading",{name:"Password updated"})).toBeVisible();
    await db.exec("update campusbite_private.student_recoveries set requested_at=requested_at-interval '61 seconds'");
    await page.setExtraHTTPHeaders({ "x-real-ip": "192.0.2.45" });
    await send();
    expect(trafficKeys[1]).toBe(trafficHash("ip/192.0.2.45"));
    const linkPath = new URL(redirect).pathname;
    const second = await other.newPage();
    await second.goto(linkPath+"#recovery="+tokenHash);
    await expect(second.getByRole("button",{name:"Confirm recovery link"})).toBeEnabled();
    expect(checks).toBe(1);
    expect(second.url()).not.toContain("#");
    await second.getByRole("button",{name:"Confirm recovery link"}).click();
    await second.getByLabel("New password",{exact:true}).fill("second-password-123");
    await second.getByLabel("Confirm new password").fill("second-password-123");
    await second.getByRole("button",{name:"Save new password"}).click();
    await expect(second.getByRole("heading",{name:"Password updated"})).toBeVisible();
    await second.goto(linkPath+"#recovery="+tokenHash);
    await second.reload();
    await second.getByRole("button",{name:"Confirm recovery link"}).click();
    await expect(second.getByText(/already been used/)).toBeVisible();
    expect(checks).toBe(2);
    expect(changes).toBe(2);
  } finally {
    await other.close();
    fixture.closeAllConnections();
    await new Promise<void>(resolve=>fixture.close(()=>resolve()));
    await db.close();
  }
});
