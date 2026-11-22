"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  basketLimit, defaultFoodCourt, isOrderable,
  type CartLine, type FoodCourtId, type Fulfillment, type Order, type Product, type Stall,
} from "./campus";

type Preview = {
  cart: CartLine[]; stalls: Stall[]; products: Product[]; orders: Order[];
  orderingPaused: boolean; started: number; campusStart: number;
  checkout: { start: number; note: string };
  foodCourt: FoodCourtId;
  live?: boolean;
};
const key = "campusbite.preview.v1";
const empty: Preview = {
  cart: [], stalls: [], products: [], orders: [],
  orderingPaused: false, started: 0, campusStart: 0, checkout: { start: 0, note: "" }, foodCourt: defaultFoodCourt,
};
const listeners = new Set<() => void>();
let snapshot = empty;
let hydrated = false;
function read() {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const previous = JSON.parse(saved);
      const data = { ...empty, cart: previous.cart ?? [], checkout: previous.checkout ?? empty.checkout,
        foodCourt: previous.foodCourt ?? defaultFoodCourt, started: previous.started ?? 0, campusStart: previous.campusStart ?? 0 };
      if ("student" in previous) localStorage.setItem(key, JSON.stringify(data));
      return data;
    }
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
export const LiveStorefronts = createContext<Pick<Preview, "stalls" | "products" | "live">>({
  stalls: [], products: [], live: false,
});
export function usePreview() {
  const data = useSyncExternalStore(subscribe, () => snapshot, () => empty);
  const storefronts = useContext(LiveStorefronts);
  return { ...data, ...storefronts };
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
  const limit = vendor?.basketLimit ?? basketLimit;
  if (qty > previous && remaining.reduce((sum, line) => sum + line.qty, 0) + qty > limit) return `Choose up to ${limit} items per order.`;
  const unitPrice = snapshot.cart.find(line => line.id === product.id)?.unitPrice ?? product.price;
  const cart = qty > 0 ? [...remaining, { id: product.id, qty, unitPrice }] : remaining;
  update(data => ({
    ...data, cart, checkout: replace || !cart.length ? empty.checkout : { ...data.checkout, start: 0 },
  }));
}
export function removeMissingCartItems(products: Product[]) {
  const ids = new Set(products.map(item=>item.id));
  update(data=>({...data,cart:data.cart.filter(line=>ids.has(line.id)),checkout:{...data.checkout,start:0}}));
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
export function clearPreviewCheckout() {
  update(current => ({ ...current, cart: [], checkout: empty.checkout }));
}
export function visibleStatus(order: Pick<Order, "status" | "deadline">, now: number): Fulfillment {
  return order.status === "awaiting" && now >= order.deadline ? "expired" : order.status;
}
