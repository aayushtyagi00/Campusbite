import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { STAGING_SUPABASE_URL, STAGING_SUPABASE_SECRET_KEY, LOAD_TEST_STALL } = process.env;
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 25);

assert(process.env.LOAD_TEST_STAGING === "1", "Set LOAD_TEST_STAGING=1 for a dedicated staging database");
assert(STAGING_SUPABASE_URL && STAGING_SUPABASE_SECRET_KEY && LOAD_TEST_STALL, "Set the staging Supabase URL, secret key and test storefront slug");
assert(Number.isInteger(concurrency) && concurrency >= 2 && concurrency <= 200, "Use a concurrency between 2 and 200");

const target = new URL(STAGING_SUPABASE_URL);
assert(target.hostname !== "dgelmtwmtnfsoybgjsqm.supabase.co", "Use a test database. This is the live CampusBite project.");
const db = createClient(STAGING_SUPABASE_URL, STAGING_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const [configuration, menu] = await Promise.all([
  db.from("commerce_stalls").select("shop_id,capacity,opens,closes,weekly_hours,closed_dates,pickup_minutes,vendor_paused").eq("slug", LOAD_TEST_STALL).eq("enabled", true).single(),
  db.from("commerce_menu").select("id,name,price,prep").eq("stall_slug", LOAD_TEST_STALL).eq("sold_out", false).limit(1).single(),
]);
assert(!configuration.error && !menu.error, "Enable the staging storefront with at least one menu item");
const item = menu.data;
const settings = configuration.data;
const basket=[{id:item.id,price:item.price,qty:1}];
const quote=await db.rpc("commerce_pickup_availability",{stall:LOAD_TEST_STALL,items:basket});
assert.ifError(quote.error);
const next=quote.data.slots.find(window=>window.start>Date.now()+(Math.max(item.prep,4)+10)*60000);
assert(next, "Choose a staging shop with an available pickup window and time for the load run.");
const slot = new Date(next.start).toISOString();

const existing = await db.from("commerce_orders").select("id", { count: "exact", head: true })
  .eq("shop_id", configuration.data.shop_id).eq("pickup_at", slot);
assert(!existing.error && existing.count === 0, "The staging pickup window already contains test records. Use another staging stall or wait for a different window.");

const runStart = performance.now();
const results = await Promise.all(Array.from({ length: concurrency }, async () => {
  const started = performance.now();
  const result = await db.rpc("commerce_reserve", {
    actor: randomUUID(), request: randomUUID(), signature: randomUUID(), stall: LOAD_TEST_STALL,
    slot, detail: { pickup_minutes:settings.pickup_minutes, name: "Load test", items: [{ id: item.id, name: item.name, price: item.price, qty: 1 }], note: "" },
    amount: item.price,
  });
  return { latency: performance.now() - started, reserved: !result.error && Boolean(result.data?.id), error: result.error?.message, code: result.error?.code };
}));
const filled = results.filter(result => result.reserved).length;
const full = results.filter(result => result.code === "P0001" && result.error === "Pickup window is full").length;
const latencies = results.map(result => result.latency).sort((a,b) => a - b);
const unexpectedFailures = concurrency - filled - full;
const elapsedSeconds = (performance.now() - runStart) / 1000;
const stored = await db.from("commerce_orders").select("id", { count: "exact", head: true })
  .eq("shop_id", configuration.data.shop_id).eq("pickup_at", slot);
assert.ifError(stored.error);
console.log({ attempts: concurrency, reserved: filled, windowFull: full, storedOrders: stored.count,
  unexpectedFailures, unexpectedFailurePercent: 100 * unexpectedFailures / concurrency,
  requestsPerSecond: Math.round(concurrency / elapsedSeconds),
  p50Ms: Math.round(latencies[Math.ceil(latencies.length * 0.5) - 1]),
  p95Ms: Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]) });
assert.equal(stored.count, filled, "Stored reservations must match successful responses");
assert.equal(filled, Math.min(configuration.data.capacity, concurrency));
assert.equal(filled + full, concurrency);
