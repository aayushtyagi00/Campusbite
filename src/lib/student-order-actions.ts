"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { basketLimit, pickupSlots, products, stalls, type CartLine, type Product } from "./campus";
import { closeStudentOrderSession, editStudentOrders, openStudentOrderSession } from "./student-order-store";
import type { StudentOrder } from "./student-order-types";
import { liveStudent } from "./student-auth";

type OrderResult = { id?: string; error?: string; signIn?: boolean };
const unavailable = { error: "Sample orders are temporarily unavailable. Please try again." };
const missingSession: OrderResult = { error: "Start a new student preview session to continue.", signIn: true };

export async function beginStudentPreview(): Promise<{ error?: string }> {
  if (liveStudent()) return { error: "The student preview is disabled." };
  try { await openStudentOrderSession(); return {}; } catch { return unavailable; }
}

export async function endStudentPreview(): Promise<{ error?: string }> {
  try { await closeStudentOrderSession(); return {}; } catch { return unavailable; }
}

export async function placeStudentOrder(lines: CartLine[], start: number, note: string, campusNow: number, requestId: string): Promise<OrderResult> {
  if (liveStudent()) return { error: "The student preview is disabled." };
  const realNow = Date.now();
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > basketLimit || !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(campusNow) || Math.abs(campusNow - realNow) > 86400000 ||
    typeof note !== "string" || note.length > 180 || typeof requestId !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(requestId)) return { error: "Review your bag and pickup window." };
  const seen = new Set<string>();
  const items: (Product & { qty: number })[] = [];
  let quantity = 0;
  for (const line of lines) {
    if (!line || typeof line.id !== "string" || seen.has(line.id) || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > basketLimit) {
      return { error: "Review the quantities in your bag." };
    }
    const product = products.find(item => item.id === line.id && !item.soldOut && !item.archived);
    if (!product) return { error: "Some items are no longer available." };
    if (line.unitPrice !== undefined && line.unitPrice !== product.price) return { error: "The preview price has changed. Review your bag." };
    seen.add(line.id);
    quantity += line.qty;
    items.push({ ...product, qty: line.qty });
  }
  const stall = stalls.find(item => item.id === items[0]?.stall);
  if (!stall || quantity > basketLimit || items.some(item => item.stall !== stall.id)) return { error: "Your bag must contain items from one stall." };

  try {
    const result = await editStudentOrders<OrderResult>(orders => {
      const id = "CB-" + createHash("sha256").update(requestId).digest("hex").slice(0, 16).toUpperCase();
      if (orders.some(order => order.id === id)) return { result: { id } };
      const slot = pickupSlots(stall, items, orders, campusNow, realNow).find(candidate => candidate.start === start);
      if (!slot) return { result: { error: "This pickup window is no longer available." } };
      if (orders.length >= 50) return { result: { error: "This preview session has reached its sample order limit." } };
      const order: StudentOrder = {
        id, stall: stall.id, name: stall.name, location: stall.location,
        items: items.map(({ name, price, qty }) => ({ name, price, qty })),
        total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
        note: note.trim(), slot, placed: campusNow, deadline: realNow + 90_000,
        status: "awaiting", payment: "Verified", refund: "None", code: "",
        events: [{ status: "Demo payment verified", at: campusNow }],
      };
      return { orders: [order, ...orders], result: { id } };
    }) ?? missingSession;
    if (result.id) revalidatePath("/orders");
    return result;
  } catch { return unavailable; }
}

export async function cancelStudentOrder(id: string): Promise<OrderResult> {
  if (liveStudent()) return { error: "The student preview is disabled." };
  try {
    return await editStudentOrders<OrderResult>(orders => {
      const order = orders.find(item => item.id === id);
      const now = Date.now();
      if (!order || order.status !== "awaiting" || order.deadline <= now) return { result: { error: "This order cannot be cancelled." } };
      const cancelled: StudentOrder = { ...order, status: "cancelled", refund: "Requested",
        events: [...order.events, { status: "Cancelled", at: order.placed + (now - (order.deadline - 90_000)) }],
      };
      return { orders: orders.map(item => item.id === id ? cancelled : item), result: {} };
    }) ?? missingSession;
  } catch { return unavailable; }
}

export async function sendStudentOrderSupport(id: string, issue: string): Promise<OrderResult> {
  if (liveStudent()) return { error: "The student preview is disabled." };
  if (typeof issue !== "string" || !issue.trim() || issue.length > 300) return { error: "Enter a support note of up to 300 characters." };
  try {
    return await editStudentOrders<OrderResult>(orders => {
      const order = orders.find(item => item.id === id);
      if (!order || order.support) return { result: { error: "Support is unavailable for this order." } };
      return { orders: orders.map(item => item.id === id ? { ...order, support: issue.trim() } : item), result: {} };
    }) ?? missingSession;
  } catch { return unavailable; }
}
