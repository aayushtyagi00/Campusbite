import "server-only";

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { stalls, type Fulfillment } from "./campus";
import type { StudentOrderHistory } from "./student-order-types";
import { studentIdentity } from "./student-auth";
import type { CommerceMenuRow } from "./staff/database";

export const commerceDb = () => {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) throw new Error("Commerce database is unavailable");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
};

export const orderUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function catalogProduct({ stall_slug, sold_out, ...item }: CommerceMenuRow) {
  return { ...item, stall: stall_slug, soldOut: sold_out };
}

const activeStorefronts = unstable_cache(async (_project: string) => {
  const db = commerceDb();
  const [storefronts, menu] = await Promise.all([
    db.from("commerce_stalls").select("slug,capacity").eq("enabled", true),
    db.from("commerce_menu").select("id,stall_slug,name,category,description,price,prep,diet,photo,sold_out").order("name"),
  ]);
  if (storefronts.error || menu.error) throw new Error("Catalog is unavailable");
  return { enabled: storefronts.data, products: (menu.data as CommerceMenuRow[]).map(catalogProduct) };
}, ["campusbite-storefronts"], { tags: ["campusbite-storefronts"], revalidate: 30 });

export async function liveStorefronts() {
  try {
    const { enabled, products } = await activeStorefronts(process.env.SUPABASE_URL ?? "");
    return { products, stalls: stalls.map(stall => {
      const config = enabled.find(item => item.slug === stall.id);
      return { ...stall, paused: !config, capacity: config?.capacity ?? stall.capacity };
    }) };
  } catch {
    return { products: [], stalls: stalls.map(stall => ({ ...stall, paused: true })) };
  }
}

export async function liveOrderHistory(includeOrders: boolean): Promise<StudentOrderHistory> {
  try {
    const actor = await studentIdentity();
    if (!actor) return { signedIn: false, orders: [] };
    if (!includeOrders) return { signedIn: true, orders: [] };
    const { data, error } = await commerceDb().from("commerce_orders")
      .select("id,detail,pickup_at,amount_paise,status,accept_until,provider_payment,refund,pickup_code,events,support,created_at")
      .eq("student_id", actor.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return { signedIn: true, orders: data.map(row => {
      const start = Date.parse(row.pickup_at);
      return {
        ...row.detail, id: row.id, total: row.amount_paise, slot: { start, end: start + 600_000 },
        status: row.status as Fulfillment, placed: Date.parse(row.created_at), deadline: Date.parse(row.accept_until) || 0,
        payment: row.provider_payment ? "Verified" : "Pending",
        refund: row.refund, code: row.pickup_code, events: row.events, support: row.support ?? undefined,
      };
    }) };
  } catch {
    return { signedIn: false, orders: [], unavailable: true };
  }
}
