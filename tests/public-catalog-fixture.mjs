import { createServer } from "node:http";

// Dedicated Supabase fixture for public browsing tests, including legacy rows.
const storefronts = [
  ["campus-wraps", "Campus Wraps"],
  ["courtyard-tea", "Courtyard Tea"],
  ["garden-grill", "Garden Grill"],
  ["rolling-kitchen", "The Rolling Kitchen"],
  ["chai-co", "Chai & Co"],
  ["punjab-plate", "Punjab Plate"],
  ["unclaimed", "Unclaimed Kitchen"],
].map(([slug, display_name]) => ({
  slug, display_name, court: "unimall", location: "UniMall", opens: "09:00", closes: "20:00",
  enabled: true, published: true, standing: "approved", capacity: 5, cuisine: "Campus food", photo: "",
}));
const approved = { applicant_id: "verified-owner", verified_at: "2026-11-01", status: "approved" };
const applications = new Map([
  ["campus-wraps", approved], ["courtyard-tea", approved], ["garden-grill", approved],
  ["chai-co", { ...approved, verified_at: null }], ["punjab-plate", { ...approved, status: "submitted" }],
  ["unclaimed", { ...approved, applicant_id: null }],
]);
const menu = [
  ["mint-wrap", "campus-wraps", "Mint Wrap", "Wraps"],
  ["ginger-tea", "courtyard-tea", "Ginger Tea", "Drinks"],
  ["paneer", "rolling-kitchen", "Paneer Tikka Wrap", "Wraps"],
].map(([id, stall_slug, name, category]) => ({
  id, stall_slug, name, category, price: 4500, prep: 4, diet: "Vegetarian",
  photo: "", description: name, sold_out: false, stock_remaining: null,
}));

createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://localhost");
  res.setHeader("Content-Type", "application/json");
  if (pathname === "/") return res.end("{}");
  if (pathname === "/rest/v1/campus_reviews" && req.method === "GET") return res.end("[]");
  if (pathname === "/rest/v1/commerce_menu") return res.end(JSON.stringify(menu));
  if (pathname !== "/rest/v1/commerce_stalls") return res.writeHead(404).end("{}");
  const select = searchParams.get("select") ?? "";
  const path = "vendor_shops.vendor_applications.";
  const visible = storefronts.filter(stall => {
    const app = applications.get(stall.slug);
    if (select.includes("vendor_shops!inner(") && select.includes("vendor_applications!inner(") && !app) return false;
    if (app && searchParams.get(path + "status") === "eq.approved" && app.status !== "approved") return false;
    if (app && searchParams.get(path + "verified_at") === "not.is.null" && !app.verified_at) return false;
    if (app && searchParams.get(path + "applicant_id") === "not.is.null" && !app.applicant_id) return false;
    return true;
  });
  res.end(JSON.stringify(visible));
}).listen(3111, "127.0.0.1");
