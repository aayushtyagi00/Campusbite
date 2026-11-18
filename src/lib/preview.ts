"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  basketLimit, defaultFoodCourt, isOrderable, products, stalls, statuses,
  type CartLine, type FoodCourtId, type Fulfillment, type Order, type Product, type Stall,
} from "./campus";

type Student = { name: string; email: string };
type Application = { name: string; owner: string; email: string; location: string; cuisine: string; license: string; status: Stall["approval"]; note: string };
type SupportCase = { order: string; issue: string; resolution: string };
type Preview = {
  cart: CartLine[]; student: Student | null; stalls: Stall[]; products: Product[]; orders: Order[];
  orderingPaused: boolean; applications: Application[]; notifications: boolean; started: number; campusStart: number;
  checkout: { start: number; note: string };
  support: SupportCase[];
  foodCourt: FoodCourtId;
  live?: boolean;
};
const key = "campusbite.preview.v1";
const empty: Preview = {
  cart: [], student: null, stalls, products, orders: [], applications: [], notifications: false,
  orderingPaused: false, started: 0, campusStart: 0, checkout: { start: 0, note: "" }, support: [], foodCourt: defaultFoodCourt,
};
const listeners = new Set<() => void>();
let snapshot = empty;
let hydrated = false;
function read() {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return { ...empty, ...JSON.parse(saved) } as Preview;
  } catch { /* The preview can still run in memory. */ }
  return empty;
}
function emit() {
  listeners.forEach(listener => listener());
}
function sync(event: StorageEvent) {
  if (event.key !== key && event.key !== null) return;
  snapshot = read();
  emit();
}
function subscribe(listener: () => void) {
  if (!hydrated) {
    snapshot = read();
    hydrated = true;
    window.addEventListener("storage", sync);
  }
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const LiveStorefronts = createContext<{ stalls: Stall[]; products: Product[] } | undefined>(undefined);
export function usePreview() {
  const data = useSyncExternalStore(subscribe, () => snapshot, () => empty);
  const storefronts = useContext(LiveStorefronts);
  return storefronts ? { ...data, ...storefronts, live: true, student: null, orderingPaused: false } : data;
}
export const usePreviewReady = () => useSyncExternalStore(subscribe, () => true, () => false);
export function previewTime(data: Preview, now: number) {
  if (data.live) return now;
  if (!now) return 0;
  if (data.started) return data.campusStart + now - data.started;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Date.parse(`${date}T12:00:00+05:30`);
}
export function useClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function update(change: (data: Preview) => Preview) {
  const now = Date.now();
  const current = snapshot.started ? snapshot : { ...snapshot, started: now, campusStart: previewTime(snapshot, now) };
  snapshot = change(current);
  try { localStorage.setItem(key, JSON.stringify(snapshot)); } catch { /* Retain this tab’s copy. */ }
  emit();
}
export function cartItems(data: Preview) {
  return data.cart.flatMap(line => {
    const product = data.products.find(item => item.id === line.id);
    return product ? [{ ...product, qty: line.qty, priceChanged: line.unitPrice !== undefined && line.unitPrice !== product.price }] : [];
  });
}
export function setQuantity(product: Product, qty: number, replace = false, catalog = snapshot): string | undefined {
  const lines = cartItems({ ...catalog, cart: snapshot.cart });
  const vendor = catalog.stalls.find(stall => stall.id === product.stall);
  const previous = lines.find(line => line.id === product.id)?.qty ?? 0;
  if (qty > previous && (!vendor || !isOrderable(vendor) || catalog.orderingPaused || product.soldOut || product.archived)) return "This item is currently unavailable.";
  if (qty > 0 && lines.some(line => line.stall !== product.stall) && !replace) return "different-stall";
  const remaining = (replace ? [] : snapshot.cart).filter(line => line.id !== product.id);
  if (remaining.reduce((sum, line) => sum + line.qty, 0) + qty > basketLimit) return `Choose up to ${basketLimit} items per order.`;
  const unitPrice = snapshot.cart.find(line => line.id === product.id)?.unitPrice ?? product.price;
  const cart = qty > 0 ? [...remaining, { id: product.id, qty, unitPrice }] : remaining;
  update(data => ({
    ...data, cart, checkout: replace || !cart.length ? empty.checkout : { ...data.checkout, start: 0 },
  }));
}
export function acknowledgePrices(catalog = snapshot.products) {
  update(data => ({
    ...data,
    cart: data.cart.map(line => ({ ...line, unitPrice: catalog.find(item => item.id === line.id)?.price })),
  }));
}
export function updateCheckout(values: Partial<Preview["checkout"]>) {
  update(data => ({ ...data, checkout: { ...data.checkout, ...values } }));
}
export function resetPreview() {
  update(() => empty);
}
export function clearPreviewCheckout() {
  update(current => ({ ...current, cart: [], checkout: empty.checkout }));
}
const transitions: Partial<Record<Fulfillment, Fulfillment[]>> = {
  awaiting: ["accepted", "rejected", "cancelled", "expired"],
  accepted: ["preparing"], preparing: ["ready"], ready: ["collected"],
};
export function visibleStatus(order: Pick<Order, "status" | "deadline">, now: number): Fulfillment {
  return order.status === "awaiting" && now >= order.deadline ? "expired" : order.status;
}
export function changeOrder(id: string, next: Fulfillment, input = ""): string | undefined {
  const order = snapshot.orders.find(entry => entry.id === id);
  const now = previewTime(snapshot, Date.now());
  if (!order || !transitions[order.status]?.includes(next)) return "This action is no longer available.";
  if ((visibleStatus(order, now) === "expired") !== (next === "expired")) return "The acceptance deadline has passed or the order state changed.";
  if (next === "collected" && (!/^\d{6}$/.test(input) || input !== order.code)) return "That pickup code did not match this order.";
  if (next === "rejected" && !input.trim()) return "Enter a reason for rejecting the order.";
  let code = order.code;
  if (next === "accepted") {
    const bytes = crypto.getRandomValues(new Uint32Array(1));
    code = String(bytes[0] % 1_000_000).padStart(6, "0");
  }
  const refund = ["cancelled", "expired", "rejected"].includes(next) ? "Requested" : order.refund;
  const status = next === "rejected" ? `${statuses[next]} · ${input.trim()}` : statuses[next];
  update(data => ({ ...data, orders: data.orders.map(entry => entry.id === id
    ? { ...entry, status: next, refund, code, events: [...entry.events, { status, at: now }] } : entry) }));
}
export function useOrderExpiry() {
  const data = usePreview();
  const now = previewTime(data, useClock());
  useEffect(() => {
    for (const order of data.orders) {
      if (order.status === "awaiting" && visibleStatus(order, now) === "expired") changeOrder(order.id, "expired");
    }
  }, [data.orders, now]);
  return now;
}
