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
