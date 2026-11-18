import { expect, test, type Page } from "@playwright/test";

async function openCheckout(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Campus cafés & food vendors (3)" })).toBeVisible();
  await page.getByRole("link", { name: /The Rolling Kitchen/ }).click();
  await page.getByRole("button", { name: "Add Paneer Tikka Wrap" }).click();
  await page.getByRole("link", { name: "View bag" }).click();
  await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();
  await page.getByRole("link", { name: "Choose pickup time" }).click();
  await page.getByRole("radio").first().check();
  await page.getByLabel("Preparation note (optional)").fill("Less spicy");
  await page.getByRole("link", { name: "Sign in to continue" }).click();
  await page.getByRole("button", { name: "Use sample student" }).click();
  await expect(page.getByRole("heading", { name: "Scheduled checkout" })).toBeVisible();
  await expect(page.getByRole("radio").first()).toBeChecked();
  await expect(page.getByLabel("Preparation note (optional)")).toHaveValue("Less spicy");
}

async function verifyPayment(page: Page) {
  await page.getByRole("button", { name: /Simulate payment/ }).click();
  await expect(page.getByRole("heading", { name: "Awaiting acceptance" })).toBeVisible();
  await expect(page).toHaveURL(/\/orders$/);
}

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
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Password setup code")).toHaveCount(0);
    await page.getByText("Set or reset your password", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Send password setup code" })).toBeVisible();
  }
  await page.goto("/auth/staff/callback?code=unverified");
  await expect(page).toHaveURL(/\/vendor\/sign-in\?error=google$/);
  await expect(page.getByText(/Google sign-in could not be completed/)).toBeVisible();
});

test("a student can cancel a pending sample order without gaining staff access", async ({ page }) => {
  await openCheckout(page);
  await verifyPayment(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByRole("heading", { name: "Cancelled", exact: true })).toBeVisible();
  await expect(page.getByText("Refund · Requested", { exact: false })).toBeVisible();
  await page.goto("/admin/access");
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test("order details stay at /orders and a separate preview session cannot read them", async ({ page, browser }) => {
  await openCheckout(page);
  await verifyPayment(page);
  const reference = await page.locator(".page-heading .eyebrow").innerText();
  await page.getByRole("button", { name: "Your orders", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(reference) }).click();
  await expect(page.getByRole("heading", { name: "Order details" })).toBeVisible();
  await expect(page).toHaveURL(/\/orders$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Order details" })).toBeVisible();
  await page.getByLabel("What happened?").fill("A private note for this sample order.");
  await page.getByRole("button", { name: "Submit sample support request" }).click();
  await expect(page.getByText("A private note for this sample order.")).toBeVisible();

  const other = await browser.newContext();
  try {
    const visitor = await other.newPage();
    const guest = await visitor.goto("/orders");
    expect(guest?.headers()["cache-control"]).toContain("no-store");
    await expect(visitor.getByText("Sign in to see your orders")).toBeVisible();
    await visitor.goto("/sign-in");
    await visitor.getByRole("button", { name: "Use sample student" }).click();
    await expect(visitor.getByRole("heading", { name: "Your account" })).toBeVisible();
    for (const url of [`/orders/${reference}`, `/orders?id=${reference}`]) {
      await visitor.goto(url);
      await expect(visitor).toHaveURL(/\/orders$/);
      await expect(visitor.getByText("No orders yet")).toBeVisible();
      await expect(visitor.getByText(reference, { exact: false })).toHaveCount(0);
    }
  } finally {
    await other.close();
  }
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out of preview" }).click();
  await expect(page.getByRole("heading", { name: "Guest" })).toBeVisible();
  await page.goto("/orders");
  await expect(page.getByText("Sign in to see your orders")).toBeVisible();
});

test("the bag requires confirmation for a different stall and a changed price", async ({ page }) => {
  await page.goto("/stalls/rolling-kitchen");
  await page.getByRole("button", { name: "Add Paneer Tikka Wrap" }).click();
  await page.goto("/stalls/chai-co");
  await page.getByRole("button", { name: "Add Adrak Elaichi Chai" }).click();
  await expect(page.getByRole("dialog", { name: "Replace your bag?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep bag" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Add Adrak Elaichi Chai" }).click();
  await page.getByRole("button", { name: "Replace bag" }).click();
  await page.getByRole("link", { name: "View bag" }).click();
  await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();
  await expect(page.getByText("Adrak Elaichi Chai", { exact: true })).toBeVisible();
  await expect(page.getByText("Paneer Tikka Wrap", { exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    const key = "campusbite.preview.v1";
    const preview = JSON.parse(localStorage.getItem(key)!);
    const chai = preview.products.find((product: { id: string }) => product.id === "adrak");
    chai.price = 3900;
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
  await expect(header.getByRole("link", { name: /Sign in or register/ })).toBeVisible();
  await orders.press("Escape");
  await expect(orders).toBeHidden();
  await navigation.getByRole("link", { name: "About CampusBite" }).click();
  await expect(page.getByText(/CampusBite connects LPU students/)).toBeVisible();
  await expect(page.getByText(/first-year B.Tech Computer Science and Engineering student/)).toBeVisible();
  await navigation.getByRole("link", { name: "Order Online" }).click();
  await expect(page.getByRole("heading", { name: "Choose a vendor (3)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Paneer Tikka Wrap" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  await page.getByRole("button", { name: "Wraps", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a vendor (1)" })).toBeVisible();
  await page.getByRole("link", { name: /The Rolling Kitchen/ }).click();
  const bag = page.getByRole("complementary", { name: "Bag summary" });
  await page.getByRole("button", { name: "Add Paneer Tikka Wrap" }).click();
  await expect(header.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  await expect(bag.getByText("1 × Paneer Tikka Wrap")).toBeVisible();
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
  await expect(slider.getByText("The Rolling Kitchen")).toBeVisible();
  await slider.getByRole("button", { name: "Next vendor" }).click();
  await expect(slider.getByText("Chai & Co")).toBeVisible();

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
  await page.getByRole("link", { name: "About Campus Bite" }).click();
  await expect(page.getByRole("heading", { name: "About CampusBite" })).toBeVisible();
});
