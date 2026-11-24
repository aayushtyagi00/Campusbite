import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { commerceDb } from "./commerce";

export function razorpayMode(key = process.env.RAZORPAY_KEY_ID?.trim()): "live" | "test" | null {
  if (/^rzp_test_[A-Za-z0-9]+$/.test(key ?? "")) return "test";
  if (/^rzp_live_[A-Za-z0-9]+$/.test(key ?? "")) return "live";
  return null;
}

export async function paymentSettings() {
  const key = process.env.RAZORPAY_KEY_ID?.trim();
  const mode = razorpayMode(key);
  if (!key || !mode || !process.env.RAZORPAY_KEY_SECRET?.trim() ||
    !process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || !process.env.COMMERCE_JOB_SECRET?.trim()) return null;
  const { data, error } = await commerceDb().from("razorpay_environment").select("mode").eq("singleton",true).single();
  return !error && data?.mode === mode ? { key, mode } : null;
}
export const providerOrder = /^order_[a-zA-Z0-9]+$/;
export const providerPayment = /^pay_[a-zA-Z0-9]+$/;

type Credentials = { key: string; secret: string };

export function adminTestCredentials(): Credentials | null {
  const key = process.env.RAZORPAY_TEST_KEY_ID?.trim();
  const secret = process.env.RAZORPAY_TEST_KEY_SECRET?.trim();
  return key && secret && razorpayMode(key) === "test" ? { key, secret } : null;
}

export async function razorpay(path: string, body?: object, extraHeaders?: Record<string, string>, credentials?: Credentials) {
  const key = credentials?.key ?? process.env.RAZORPAY_KEY_ID?.trim();
  const secret = credentials?.secret ?? process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!key || !secret) throw new Error("Payment provider is unavailable");
  const response = await fetch("https://api.razorpay.com/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Basic " + Buffer.from(key + ":" + secret).toString("base64"),
      "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(7000), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("Payment provider request failed");
  return response.json();
}

export function signed(raw: string | Buffer, signature: string, secret: string) {
  return typeof signature === "string" && signature.length === 64 && /^[a-f0-9]{64}$/i.test(signature) &&
    timingSafeEqual(createHmac("sha256", secret).update(raw).digest(), Buffer.from(signature, "hex"));
}

export async function verifiedCapture(order: string, payment: string, amount: number, credentials?: Credentials) {
  const record = await razorpay("/payments/" + payment, undefined, undefined, credentials);
  return record.id === payment && record.order_id === order && record.status === "captured" &&
    record.captured === true && record.currency === "INR" && record.amount === amount &&
    Number.isSafeInteger(amount) && amount > 0 && record.amount_refunded === 0;
}

export async function findOrCreateRazorpayOrder(reference: string, amount: number, credentials?: Credentials) {
  const create = () => razorpay("/orders", { amount, currency: "INR", receipt: reference }, undefined, credentials);
  const order = await create().catch(async () => {
    const results = await razorpay("/orders?receipt=" + encodeURIComponent(reference) + "&count=10", undefined, undefined, credentials);
    return (results.items as { receipt: string }[] | undefined)?.find(item => item.receipt === reference);
  });
  if (!order || !providerOrder.test(order.id) || order.amount !== amount || order.currency !== "INR" || order.receipt !== reference) {
    throw new Error("Could not verify the gateway order");
  }
  return order.id as string;
}
