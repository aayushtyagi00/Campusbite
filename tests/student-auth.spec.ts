import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3109" });

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

test("admin navigation keeps the current workspace visible during a slow shop query", async ({ page, context }) => {
  const user = { id: "00000000-0000-4000-8000-000000000002", email: "admin@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
  let releaseShops = () => {};
  const holdShops = new Promise<void>(resolve => { releaseShops = resolve; });
  let waiting = false;
  const fixture = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    res.setHeader("Content-Type", "application/json");
    if (path === "/auth/v1/user") return res.end(JSON.stringify(user));
    if (path === "/rest/v1/rpc/campusbite_is_admin") return res.end("true");
    if (path === "/rest/v1/vendor_shops" && req.method === "GET") {
      waiting = true;
      await holdShops;
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
  } finally {
    releaseShops();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
});
