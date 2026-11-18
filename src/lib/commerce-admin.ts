"use server";

import { revalidatePath, updateTag } from "next/cache";
import { stalls } from "./campus";
import { orderUuid } from "./commerce";
import { adminSession } from "./staff/access";

export async function saveStorefront(form: FormData) {
  const session = await adminSession(true);
  if (!session) return { error: "Administrator access is required." };
  const slug = String(form.get("slug") ?? "");
  const shop = String(form.get("shop") ?? "");
  const capacity = Number(form.get("capacity"));
  if (!stalls.some(stall => stall.id === slug) || !orderUuid.test(shop) || !Number.isInteger(capacity) || capacity < 1 || capacity > 100)
    return { error: "Select a valid storefront, shop and capacity." };
  const { error } = await session.client.from("commerce_stalls").upsert({
    slug, shop_id: shop, capacity, enabled: form.get("enabled") === "on",
  });
  if (error) return { error: "Could not save. Check that the shop is not already linked to another storefront." };
  updateTag("campusbite-storefronts");
  revalidatePath("/admin/orders");
  return {};
}
