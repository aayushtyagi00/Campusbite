import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3109" });

function fixtureToken(user: string, session: string, aal: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    sub: user, session_id: session, aud: "authenticated", role: "authenticated", aal,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return [header, body, createHmac("sha256", "local-provider-fixture").update(header + "." + body).digest("base64url")].join(".");
}

test("admin sign-in verifies the Google mailbox and requires the authenticator before loading admin data", async ({ page, context }) => {
  const userId = randomUUID(), sessionId = randomUUID(), factorId = randomUUID();
  const user = { id: userId, email: "tyagiaayush3030@gmail.com", email_confirmed_at: new Date().toISOString(),
    factors: [] as { id: string; status: string; factor_type: string }[] };
  const first = fixtureToken(userId, sessionId, "aal1"), second = fixtureToken(userId, sessionId, "aal2");
  const session = (access_token: string) => ({ access_token, user, token_type: "bearer", refresh_token: "fixture-refresh", expires_in: 3600 });
  let googleToken = "google-other-fixture", registered = false, verified = false, adminReads = 0;
  const fixture = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (path === "/auth/v1/token" && req.method === "POST" && body.code_verifier)
      return res.end(JSON.stringify({ ...session(first), provider_token: googleToken }));
    if (path === "/auth/v1/user") return res.end(JSON.stringify(user));
    if (path === "/auth/v1/logout") return res.writeHead(204).end();
    if (path === "/rest/v1/rpc/end_staff_session") { registered = false; return res.writeHead(204).end(); }
    if (path === "/rest/v1/rpc/register_admin_session") {
      registered = body.login_session === sessionId && body.login_user === userId && body.google_subject === "owner-sub";
      return res.end(JSON.stringify(registered));
    }
    if (path === "/rest/v1/rpc/campusbite_owner_state") return res.end(JSON.stringify(
      registered ? (verified && req.headers.authorization === "Bearer " + second ? "granted" : "challenge") : "denied"));
    if (path === "/rest/v1/rpc/campusbite_consume_attempt") return res.end("true");
    if (path === "/auth/v1/factors" && req.method === "POST" && registered) {
      user.factors = [{ id: factorId, status: "unverified", factor_type: "totp" }];
      return res.end(JSON.stringify({ id: factorId, type: "totp", totp: { secret: "FIXTURESETUPKEY", qr_code: "fixture" } }));
    }
    if (path === "/auth/v1/factors/" + factorId + "/challenge") return res.end('{"id":"fixture-challenge","type":"totp"}');
    if (path === "/auth/v1/factors/" + factorId + "/verify" && body.challenge_id === "fixture-challenge" && body.code === "123456") {
      verified = true;
      user.factors[0].status = "verified";
      return res.end(JSON.stringify(session(second)));
    }
    if (path === "/rest/v1/vendor_shops" || path === "/rest/v1/vendor_applications") {
      adminReads++;
      res.setHeader("Content-Range", "0-0/1");
      return res.end("[]");
    }
    return res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve, reject) => fixture.once("error", reject).listen(3110, "127.0.0.1", resolve));
  try {
    await page.route("http://127.0.0.1:3110/auth/v1/authorize**", route => route.fulfill({ body: "Local Google provider" }));
    async function googleLogin() {
      await page.goto("/admin/sign-in");
      await page.getByRole("button", { name: "Continue with Google" }).click();
      await page.waitForURL("http://127.0.0.1:3110/auth/v1/authorize**");
      await page.goto("http://127.0.0.1:3109/auth/staff/callback?code=local-fixture");
    }
    await googleLogin();
    await expect(page).toHaveURL(/\/admin\/sign-in\?error=google$/);
    expect(registered).toBe(false);
    expect((await context.cookies()).find(cookie => cookie.name === "campusbite-staff")).toBeUndefined();
    googleToken = "google-owner-fixture";
    await googleLogin();
    await expect(page.getByRole("heading", { name: "Administrator verification" })).toBeVisible();
    expect(registered).toBe(true);
    await page.goto("/admin/access");
    await expect(page).toHaveURL(/\/admin\/security$/);
    expect(adminReads).toBe(0);
    await page.getByRole("button", { name: "Use authenticator app" }).click();
    await expect(page.getByText("FIXTURESETUPKEY")).toBeVisible();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("heading", { name: "CampusBite Admin" })).toBeVisible();
    expect(adminReads).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    expect(registered).toBe(false);
    await page.goto("/admin/access");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
  } finally {
    fixture.closeAllConnections();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});

test("a vendor confirms their mailbox, sets a password, and signs in to the assigned shop", async ({ page, context }) => {
  const id = randomUUID(), shop = randomUUID(), setupId = randomUUID(), loginId = randomUUID();
  const email = "vendor@example.test", password = "Local-test-password-32";
  const user = { id, email, email_confirmed_at: new Date().toISOString() };
  const token = (login: string) => ({ access_token: fixtureToken(id, login, "aal1"), user,
    token_type: "bearer", refresh_token: "fixture-refresh", expires_in: 3600 });
  let requested = false, saved = false, confirmed = false, registered = false;
  const fixture = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    switch (url.pathname) {
      case "/rest/v1/rpc/campusbite_consume_attempt": return res.end("true");
      case "/rest/v1/vendor_access": return res.end(JSON.stringify([{ shop_id: shop, email, role: "staff", created_at: user.email_confirmed_at }]));
      case "/auth/v1/user":
        if (req.method === "PUT") saved = body.password === password;
        return res.end(JSON.stringify(user));
      case "/auth/v1/otp": requested = body.email === email; return res.end("{}");
      case "/auth/v1/verify":
        if (requested && body.email === email && body.token === "123456") return res.end(JSON.stringify(token(setupId)));
        break;
      case "/auth/v1/logout": return res.writeHead(204).end();
      case "/auth/v1/token":
        if (body.email === email && body.password === password) return res.end(JSON.stringify(token(loginId)));
        break;
      case "/rest/v1/rpc/confirm_vendor_password_setup":
        confirmed = saved && body.login_session === setupId && body.login_user === id && body.login_email === email;
        return res.end(JSON.stringify(confirmed));
      case "/rest/v1/rpc/register_vendor_session":
        registered = confirmed && body.login_session === loginId && body.login_user === id && body.login_email === email;
        return res.end(JSON.stringify(registered));
      case "/rest/v1/rpc/campusbite_vendor_session": return res.end(JSON.stringify(registered));
      case "/rest/v1/vendor_shops": return res.end(JSON.stringify([{ id: shop, name: "Fixture kitchen" }]));
      case "/rest/v1/rpc/vendor_order_feed": return res.end("[]");
    }
    return res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve,reject) => fixture.once("error",reject).listen(3110,"127.0.0.1",resolve));
  try {
    await page.goto("/vendor/sign-in");
    const signIn = async () => {
      await page.getByLabel("Email address", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    };
    await signIn();
    await expect(page.getByText(/Could not sign in/)).toBeVisible();
    expect(registered).toBe(false);
    await page.getByText("Set or reset your password").click();
    await page.getByLabel("Approved email address").fill(email);
    await page.getByRole("button", { name: "Send password setup code" }).click();
    await page.getByLabel("Password setup code").fill("123456");
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password").fill(password);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText(/Password saved/)).toBeVisible();
    expect(confirmed).toBe(true);
    expect((await context.cookies()).some(cookie => cookie.name === "campusbite-staff")).toBe(false);
    await signIn();
    await expect(page.getByRole("heading", { name: "Order board" })).toBeVisible();
    expect(registered).toBe(true);
    await page.goto("/admin/access");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
  } finally {
    fixture.closeAllConnections();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});
