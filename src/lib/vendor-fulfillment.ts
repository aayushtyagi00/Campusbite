"use server";

import { revalidatePath, updateTag } from "next/cache";
import { staffSession } from "./staff/supabase";
import { orderUuid } from "./commerce";

export async function fulfillOrder(id: string, next: string, code: string) {
  if (!orderUuid.test(id) || !["accepted","rejected","preparing","ready","collected"].includes(next)
    || (next === "collected" && !/^\d{6}$/.test(code))) return { error: "Enter a valid pickup code or order action." };
  const session = await staffSession(true);
  if (!session) return { error: "Sign in again." };
  const result = await session.client.rpc("commerce_fulfill", { order_id: id, next_status: next, submitted_code: code });
  if (result.error || !result.data) return { error: "The action is unavailable or the pickup code is incorrect." };
  revalidatePath("/vendor/dashboard");
  return {};
}

export async function saveMenuItem(id: string, changes: FormData) {
  const session = await staffSession(true);
  if (!session) return { error: "Sign in again." };
  const amount = String(changes.get("price") ?? "");
  const price = Math.round(Number(amount) * 100);
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || price < 100 || price > 1000000)
    return { error: "Enter a price between ₹1 and ₹10,000." };
  const { error, data } = await session.client.from("commerce_menu").update({
    price, sold_out: changes.get("soldOut") === "on",
  }).eq("id", id).select("id").maybeSingle();
  if (error || !data) return { error: "The item could not be updated. Check your shop access." };
  updateTag("campusbite-storefronts");
  revalidatePath("/vendor/dashboard");
  return {};
}
