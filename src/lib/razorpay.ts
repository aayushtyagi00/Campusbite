import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const razorpayKey = () => process.env.RAZORPAY_KEY_ID?.trim();
export const providerOrder = /^order_[a-zA-Z0-9]+$/;
export const providerPayment = /^pay_[a-zA-Z0-9]+$/;

export async function razorpay(path: string, body?: object, extraHeaders?: Record<string, string>) {
  const key = razorpayKey();
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!key || !secret) throw new Error("Payment provider is unavailable");
  const response = await fetch("https://api.razorpay.com/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Basic " + Buffer.from(key + ":" + secret).toString("base64"),
      "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(7000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Payment provider request failed");
  return response.json();
}

export function signed(raw: string, signature: string, secret: string) {
  return /^[a-f0-9]{64}$/i.test(signature) &&
    timingSafeEqual(createHmac("sha256", secret).update(raw).digest(), Buffer.from(signature, "hex"));
}

export async function findOrCreateRazorpayOrder(reference: string, amount: number) {
  const create = () => razorpay("/orders", { amount, currency: "INR", receipt: reference });
  const order = await create().catch(async () => {
    const results = await razorpay("/orders?receipt=" + encodeURIComponent(reference) + "&count=10");
    return (results.items as { receipt: string }[] | undefined)?.find(item => item.receipt === reference);
  });
  if (!order || !providerOrder.test(order.id) || order.amount !== amount || order.currency !== "INR" || order.receipt !== reference) {
    throw new Error("Could not verify the gateway order");
  }
  return order.id as string;
}
