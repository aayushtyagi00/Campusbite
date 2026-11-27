import { expect, test } from "@playwright/test";

test("the public vendor page offers applications while staff routes require sign-in", async ({ page }) => {
  await page.goto("/vendor");
  await expect(page.getByRole("heading", { name: "Apply as a Vendor" })).toBeVisible();
  await expect(page.getByLabel("Shop name")).toBeVisible();
  await expect(page.getByLabel("Contact email")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign In", exact: true }).first()).toHaveAttribute("href", "/vendor/sign-in");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  for (const path of ["/vendor/dashboard", "/vendor/menu", "/vendor/earnings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/vendor\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Vendor sign in" })).toBeVisible();
  }
  for (const path of ["/admin", "/admin/access", "/admin/applications", "/admin/refunds"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  }
  for (const path of ["/vendor/sign-in", "/admin/sign-in"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    if (path === "/admin/sign-in") {
      await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Set or reset your password", { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
      await expect(page.getByLabel("Password setup code")).toHaveCount(0);
      await page.getByText("Set or reset your password", { exact: true }).click();
      await expect(page.getByRole("button", { name: "Send password setup code" })).toBeVisible();
    }
  }
  await page.goto("/auth/staff/callback?code=unverified");
  await expect(page).toHaveURL(/\/vendor\/sign-in\?error=google$/);
  await expect(page.getByText(/Google sign-in could not be completed/)).toBeVisible();
});

test("a cached sample profile cannot sign in or open orders", async ({ page }) => {
  await page.goto("/admin/payment-test");
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("campusbite.preview.v1", JSON.stringify({
    student: { name: "Old profile", email: "old@example.test" },
  })));
  await page.goto("/sign-in?returnTo=checkout");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sample|preview/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("campusbite.preview.v1")!).student ?? null)).toBeNull();
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Sign in or register" })).toBeVisible();
  await page.goto("/orders");
  await expect(page.getByText("Sign in to see your orders")).toBeVisible();
  await page.goto("/recovery");
  await expect(page.getByRole("button", { name: "Email a code" })).toBeVisible();
});

test("the bag requires confirmation for a different stall and a changed price", async ({ page }) => {
  await page.goto("/stalls/campus-wraps");
  await page.getByRole("button", { name: "Add Mint Wrap" }).click();
  await page.goto("/stalls/courtyard-tea");
  await page.getByRole("button", { name: "Add Ginger Tea" }).click();
  await expect(page.getByRole("dialog", { name: "Replace your bag?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep bag" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Add Ginger Tea" }).click();
  await page.getByRole("button", { name: "Replace bag" }).click();
  await page.getByRole("link", { name: "View bag" }).click();
  await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();
  await expect(page.getByText("Ginger Tea", { exact: true })).toBeVisible();
  await expect(page.getByText("Mint Wrap", { exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    const key = "campusbite.preview.v1";
    const preview = JSON.parse(localStorage.getItem(key)!);
    preview.cart[0].unitPrice = 1;
    localStorage.setItem(key, JSON.stringify(preview));
  });
  await page.reload();
  await expect(page.getByText("One or more prices changed.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Accept updated prices" }).click();
  await expect(page.getByText("One or more prices changed.", { exact: false })).toHaveCount(0);
});

test("the student shell serves an offline fallback without caching orders", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ display: "standalone", start_url: "/" });
  await context.setOffline(true);
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
});

test("a partially damaged legacy cart keeps usable items and asks the student to confirm their prices", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("campusbite.preview.v1", JSON.stringify({
    cart: [null, { id: "mint-wrap", qty: 2 }, { id: "mint-wrap", qty: 1 }, { id: "ginger-tea", qty: -1 }],
    checkout: { start: "unknown", note: null }, started: "old preview",
  })));
  await page.goto("/bag");
  await expect(page.getByRole("link", { name: "Cart, 2 items" })).toBeVisible();
  await page.getByRole("button", { name: "Accept updated prices" }).click();
  await expect(page.getByRole("button", { name: "Accept updated prices" })).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("campusbite.preview.v1")!));
  expect(saved.cart).toEqual([{ id: "mint-wrap", qty: 2, unitPrice: 4500 }]);
  expect(saved.checkout).toEqual({ start: 0, note: "" });
});

test("laptop shoppers can browse and check out using the desktop layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const header = page.getByRole("banner");
  const navigation = header.getByRole("navigation", { name: "Main navigation" });
  const court = header.getByRole("button", { name: /Select Food Court/ });
  const profile = header.getByText("Profile", { exact: true });
  const courtSize = await court.boundingBox();
  const profileSize = await profile.boundingBox();
  expect(courtSize?.width).toBe(profileSize?.width);
  expect(courtSize?.height).toBe(profileSize?.height);
  await header.getByText("Profile", { exact: true }).click();
  const orders = header.getByRole("link", { name: /My orders/ });
  await expect(orders).toBeVisible();
  await expect(header.getByRole("link", { name: "My account", exact: false })).toBeVisible();
  await orders.press("Escape");
  await expect(orders).toBeHidden();
  await navigation.getByRole("link", { name: "About CampusBite" }).click();
  await expect(page.getByText(/CampusBite connects LPU students/)).toBeVisible();
  await expect(page.getByText(/first-year B.Tech Computer Science and Engineering student/)).toBeVisible();
  await navigation.getByRole("link", { name: "Order Online" }).click();
  await expect(page.getByRole("heading", { name: "Choose a vendor (3)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Mint Wrap" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  await page.getByRole("button", { name: "Wraps", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a vendor (1)" })).toBeVisible();
  await page.getByRole("link", { name: /Campus Wraps/ }).click();
  const bag = page.getByRole("complementary", { name: "Bag summary" });
  await page.getByRole("button", { name: "Add Mint Wrap" }).click();
  await expect(header.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  await expect(bag.getByText("1 × Mint Wrap")).toBeVisible();
  await bag.getByRole("link", { name: "View bag" }).click();
  await page.getByRole("link", { name: "Choose pickup time" }).click();
  await page.getByRole("radio").first().check();
  await expect(page.getByRole("heading", { name: "Price breakdown" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to continue" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
});

test("food court selection filters vendors and persists across pages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const slider = page.getByRole("region", { name: "Featured campus vendors" });
  await expect(slider.getByText("Campus Wraps")).toBeVisible();
  await slider.getByRole("button", { name: "Next vendor" }).click();
  await expect(slider.getByText("Courtyard Tea")).toBeVisible();

  const select = page.getByRole("banner").getByRole("button", { name: /Select Food Court/ });
  await select.click();
  const picker = page.getByRole("dialog", { name: "Select Food Court" });
  await expect(picker.getByRole("button", { name: "UniMall", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Near Block 2 - CC", "Near Block 41", "Near Boys' Hostel 5-6"]) {
    await expect(picker.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await picker.getByRole("button", { name: "Near Block 41" }).click();
  await expect(page.getByRole("heading", { name: "No vendors listed at this food court yet" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Order Online" }).click();
  await expect(page).toHaveURL(/\/order-online$/);
  await page.reload();
  await expect(select).toContainText("Near Block 41");
  await expect(page.getByRole("heading", { name: "Choose a vendor (0)" })).toBeVisible();
  await page.getByRole("button", { name: "Show UniMall vendors" }).click();
  await expect(page.getByRole("heading", { name: "Choose a vendor (3)" })).toBeVisible();
});

test("mobile navigation restores the Stitch dock and puts About under Account", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Home Page", "Order Online", "Account"]);
  await expect(page.getByRole("heading", { name: /Your break.*Made delicious/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Featured campus vendors" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "Cart, 0 items" })).toHaveText("", { useInnerText: true });
  const navBox = await nav.boundingBox();
  expect(navBox!.y + navBox!.height).toBe(844);
  await nav.getByRole("link", { name: "Order Online" }).click();
  await expect(page.getByRole("heading", { name: "Order Online" })).toBeVisible();
  await nav.getByRole("link", { name: "Account" }).click();
  await page.getByRole("link", { name: "About CampusBite" }).click();
  await expect(page.getByRole("heading", { name: "About CampusBite" })).toBeVisible();
});

test("guests see verified vendors and cannot open seeded or unverified listings", async ({ page }) => {
  for (const path of ["/", "/court", "/order-online"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Campus Wraps" })).toBeVisible();
    await expect(page.getByText(/The Rolling Kitchen|Chai & Co|Punjab Plate|Unclaimed Kitchen/)).toHaveCount(0);
  }
  for (const slug of ["rolling-kitchen", "chai-co", "punjab-plate", "unclaimed"]) {
    await page.goto("/stalls/" + slug);
    await expect(page.getByRole("heading", { name: "Stall unavailable" })).toBeVisible();
  }
  await page.goto("/products/paneer");
  await expect(page.getByRole("heading", { name: "Item unavailable" })).toBeVisible();
});
