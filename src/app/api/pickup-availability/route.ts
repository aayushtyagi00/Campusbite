import { commerceDb, orderUuid } from "@/lib/commerce";
import { liveCommerce, studentIdentity } from "@/lib/student-auth";
import { basketLimit } from "@/lib/campus";

export async function POST(request: Request) {
  if (!liveCommerce()) return new Response(null,{status:404});
  const body = await request.json().catch(()=>null);
  const items = body?.items;
  if (typeof body?.stall !== "string" || !/^[a-z0-9-]{1,80}$/.test(body.stall) ||
    !Array.isArray(items) || items.length<1 || items.length>basketLimit ||
    items.some(line=>!line || typeof line.id!=="string" || !line.id || line.id.length>160 ||
      !Number.isInteger(line.qty) || line.qty<1 || line.qty>basketLimit ||
      !Number.isInteger(line.price) || line.price<100 || line.price>1000000)) return new Response(null,{status:400});
  try {
    const requestId = typeof body.requestId==="string" && orderUuid.test(body.requestId) ? body.requestId : null;
    const student = requestId ? await studentIdentity() : null;
    const {data,error} = await commerceDb().rpc("commerce_pickup_availability",{
      stall:body.stall, items:items.map(({id,qty,price})=>({id,qty,price})), actor:student?.id ?? null, request:requestId,
    });
    if (error || !Array.isArray(data?.slots)) return new Response(null,{status:503});
    return Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
  } catch { return new Response(null,{status:503}); }
}
