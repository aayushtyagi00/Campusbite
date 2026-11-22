"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { basketLimit, type CartLine, type Product } from "./campus";
import { commerceDb, liveStorefronts, orderUuid } from "./commerce";
import { findOrCreateRazorpayOrder, paymentSettings, providerPayment, signed, verifiedCapture } from "./razorpay";
import { liveCommerce, studentIdentity } from "./student-auth";

type Result = { id?: string; error?: string; signIn?: boolean; gateway?: { order: string; key: string; amount: number } };

export async function startLiveCheckout(lines: CartLine[], start: number, note: string, requestId: string, minutes = 10): Promise<Result> {
  if (!liveCommerce()) return { error: "Live checkout is disabled." };
  const actor = await studentIdentity(true);
  if (!actor) return { signIn: true };
  const settings = await paymentSettings().catch(() => null);
  if (!settings) return { error: "Payments are temporarily unavailable for this environment." };
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > basketLimit || !orderUuid.test(requestId) ||
      !Number.isInteger(minutes) || minutes < 1 || minutes > 60 || !Number.isSafeInteger(start) || typeof note !== "string" || note.length > 180) return { error: "Review your bag and pickup window." };
  const { stalls, products } = await liveStorefronts();
  const seen = new Set<string>();
  const items: (Product & { qty: number })[] = [];
  for (const line of lines) {
    if (!line || typeof line.id !== "string" || seen.has(line.id) || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > basketLimit)
      return { error: "Review your quantities." };
    const product = products.find(item => item.id === line.id && !item.soldOut);
    if (!product || line.unitPrice !== product.price) return { error: "An item or price has changed. Review your bag." };
    seen.add(line.id);
    items.push({ ...product, qty: line.qty });
  }
  const stall = stalls.find(item => item.id === items[0]?.stall);
  if (!stall || items.some(item => item.stall !== stall.id) || items.reduce((sum, item) => sum + item.qty, 0) > basketLimit)
    return { error: "Orders must contain up to eight items from one stall." };
  if (stall.basketLimit && items.reduce((sum,item)=>sum+item.qty,0)>stall.basketLimit)
    return { error: `Choose up to ${stall.basketLimit} items for this stall.` };
  const amount = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const detail = { ...(minutes === 10 ? {} : {pickup_minutes:minutes}), stall: stall.id, name: stall.name, location: stall.location, note: note.trim(),
    items: items.map(({ id, name, price, qty }) => ({ id, name, price, qty })) };
  try {
    const db = commerceDb();
    const fingerprint = createHash("sha256").update(JSON.stringify({ detail, start })).digest("hex");
    const existing = await db.from("commerce_orders").select("id,fingerprint,reserved_until,status,provider_order")
      .eq("student_id", actor.id).eq("request_id", requestId).maybeSingle();
    if (existing.error) throw existing.error;
    let order = existing.data;
    if (!order) {
      const result = await db.rpc("commerce_reserve", {
        actor: actor.id, request: requestId, signature: fingerprint, stall: stall.id,
        slot: new Date(start).toISOString(), detail, amount,
      });
      if (result.error?.code === "P0001") return { error: result.error.message + "." };
      if (result.error) throw result.error;
      order = result.data;
    }
    if (!order || order.fingerprint !== fingerprint) return { error: "Your bag changed. Start checkout again." };
    if (order.status !== "unpaid") return { id: order.id };
    if (Date.parse(order.reserved_until) <= Date.now()) return { error: "Your payment window expired. Choose a pickup window again." };
    let provider = order.provider_order;
    if (!order.provider_order) {
      const candidate = await findOrCreateRazorpayOrder(order.id, amount);
      const update = await db.from("commerce_orders").update({ provider_order: candidate })
        .eq("id", order.id).is("provider_order", null).select("provider_order").maybeSingle();
      if (update.error) throw update.error;
      provider = update.data?.provider_order;
      if (!provider) {
        const bound = await db.from("commerce_orders").select("provider_order").eq("id", order.id).single();
        if (bound.error || !bound.data?.provider_order) throw new Error("Could not recover checkout");
        provider = bound.data.provider_order;
      }
    }
    if (Date.parse(order.reserved_until) <= Date.now()) return { error: "Your payment window expired. Choose a pickup window again." };
    return { id: order.id, gateway: { order: provider, key: settings.key, amount } };
  } catch { return { error: "Could not open payment. Please retry the same checkout." }; }
}

export async function confirmLiveCheckout(id: string, payment: string, signature: string): Promise<Result> {
  if (!liveCommerce() || typeof id !== "string" || !orderUuid.test(id) || typeof payment !== "string" ||
    payment.length > 80 || !providerPayment.test(payment) || typeof signature !== "string") return { error: "Invalid payment response." };
  const actor = await studentIdentity(true);
  if (!actor) return { signIn: true };
  try {
    const db = commerceDb();
    const { data, error } = await db.from("commerce_orders").select("provider_order,amount_paise")
      .eq("id", id).eq("student_id", actor.id).single();
    const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (error || !data?.provider_order || !secret || !signed(data.provider_order + "|" + payment, signature, secret))
      return { error: "The payment could not be verified." };
    const settings = await paymentSettings();
    if (!settings || !await verifiedCapture(data.provider_order, payment, data.amount_paise))
      return { error: "Payment is awaiting confirmation. Check My Orders before retrying." };
    const result = await db.rpc("commerce_apply_razorpay_event", {
      event_id: "callback:" + payment, kind: "payment.captured", payment_id: payment,
      gateway_order: data.provider_order, amount: data.amount_paise, currency: "INR", key_mode: settings.mode,
    });
    if (result.error || result.data !== true) return { error: "Payment is awaiting confirmation. Check My Orders before retrying." };
    revalidatePath("/orders");
    return { id };
  } catch { return { error: "We are still checking your payment. Check My Orders before trying again." }; }
}

export async function updateLiveStudentOrder(id: string, issue?: string): Promise<Result> {
  if (!orderUuid.test(id)) return { error: "Order unavailable." };
  const actor = await studentIdentity(true);
  if (!actor) return { signIn: true };
  try {
    const db = commerceDb();
    if (issue === undefined) {
      const result = await db.rpc("commerce_cancel", { actor: actor.id, order_id: id });
      if (result.error || !result.data) return { error: "This order cannot be cancelled." };
    } else {
      if (typeof issue !== "string" || !issue.trim() || issue.length > 300) return { error: "Enter a support note of up to 300 characters." };
      const result = await db.from("commerce_orders").update({ support: issue.trim() }).eq("id", id)
        .eq("student_id", actor.id).is("support", null).select("id").maybeSingle();
      if (result.error || !result.data) return { error: "Support is unavailable for this order." };
    }
    return {};
  } catch { return { error: "Orders are temporarily unavailable." }; }
}
