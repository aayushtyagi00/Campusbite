import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, LOAD_TEST_STALL } = process.env;
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 25);

assert(process.env.LOAD_TEST_STAGING === "1", "Set LOAD_TEST_STAGING=1 for a dedicated staging database");
assert(SUPABASE_URL && SUPABASE_SECRET_KEY && LOAD_TEST_STALL, "Set the staging Supabase URL, secret key and test storefront slug");
assert(Number.isInteger(concurrency) && concurrency >= 2 && concurrency <= 200, "Use a concurrency between 2 and 200");

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const [configuration, menu] = await Promise.all([
  db.from("commerce_stalls").select("shop_id,capacity").eq("slug", LOAD_TEST_STALL).eq("enabled", true).single(),
  db.from("commerce_menu").select("id,name,price,prep").eq("stall_slug", LOAD_TEST_STALL).eq("sold_out", false).limit(1).single(),
]);
assert(!configuration.error && !menu.error, "Enable the staging storefront with at least one menu item");
const item = menu.data;
const windowMs = 600_000;
const slot = new Date(Math.ceil((Date.now() + (item.prep + 10) * 60_000) / windowMs) * windowMs).toISOString();

const existing = await db.from("commerce_orders").select("id", { count: "exact", head: true })
  .eq("shop_id", configuration.data.shop_id).eq("pickup_at", slot);
assert(!existing.error && existing.count === 0, "The staging pickup window already contains test records. Use another staging stall or wait for a different window.");

const results = await Promise.all(Array.from({ length: concurrency }, async () => {
  const started = performance.now();
  const result = await db.rpc("commerce_reserve", {
    actor: randomUUID(), request: randomUUID(), signature: randomUUID(), stall: LOAD_TEST_STALL,
    slot, detail: { name: "Load test", items: [{ id: item.id, name: item.name, price: item.price, qty: 1 }], note: "" },
    amount: item.price,
  });
  return { latency: performance.now() - started, error: result.error?.message };
}));
const filled = results.filter(result => !result.error).length;
const full = results.filter(result => result.error === "Pickup window is full").length;
const latencies = results.map(result => result.latency).sort((a,b) => a - b);
console.log({ concurrency, filled, full, unexpectedFailures: concurrency - filled - full,
  p95Ms: Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]) });
assert.equal(filled, Math.min(configuration.data.capacity, concurrency));
assert.equal(filled + full, concurrency);
