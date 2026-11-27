import { commerceDb, orderUuid } from "@/lib/commerce";
import { liveCommerce, studentIdentity } from "@/lib/student-auth";
import { basketLimit } from "@/lib/campus";
import { readLimitedBody } from "@/lib/request-body";
import { allowAttempt } from "@/lib/staff/access";
import { requestNetwork } from "@/lib/request-network";
import { staffService } from "@/lib/staff/supabase";

export async function POST(request: Request) {
  if (!liveCommerce()) return new Response(null,{status:404});
  let body;
  try {
    const raw = await readLimitedBody(request, 8192);
    if (!raw) return new Response(null, { status: 413 });
    body = JSON.parse(raw.toString("utf8"));
  } catch { return new Response(null, { status: 400 }); }
  const items = body?.items;
  if (typeof body?.stall !== "string" || !/^[a-z0-9-]{1,80}$/.test(body.stall) ||
    !Array.isArray(items) || items.length<1 || items.length>basketLimit ||
    items.some(line=>!line || typeof line.id!=="string" || !line.id || line.id.length>160 ||
      !Number.isInteger(line.qty) || line.qty<1 || line.qty>basketLimit ||
      !Number.isInteger(line.price) || line.price<100 || line.price>1000000)) return new Response(null,{status:400});
  try {
    const service = staffService();
    if (!service) return new Response(null, { status: 503 });
    const network = await requestNetwork();
    let permitted;
    if (network) {
      permitted = await allowAttempt(service, "pickup-availability", network, 1800, 60);
    } else {
      const shop = await service.from("commerce_stalls").select("shop_id").eq("slug", body.stall)
        .eq("published", true).eq("standing", "approved").maybeSingle();
      if (shop.error) return new Response(null, { status: 503 });
      if (!shop.data?.shop_id) return Response.json({ slots: [], message: "Shop unavailable" }, { headers: { "Cache-Control": "private, no-store" } });
      permitted = await allowAttempt(service, "pickup-availability-shop", shop.data.shop_id, 1800, 60);
    }
    if (permitted === null) return new Response(null, { status: 503 });
    if (!permitted)
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    const requestId = typeof body.requestId==="string" && orderUuid.test(body.requestId) ? body.requestId : null;
    const student = requestId ? await studentIdentity() : null;
    const {data,error} = await commerceDb().rpc("commerce_pickup_availability",{
      stall:body.stall, items:items.map(({id,qty,price})=>({id,qty,price})), actor:student?.id ?? null, request:requestId,
    });
    if (error || !Array.isArray(data?.slots)) return new Response(null,{status:503});
    return Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
  } catch { return new Response(null,{status:503}); }
}
