import { staffClient } from "@/lib/staff/supabase";
import { orderUuid } from "@/lib/commerce";

export async function GET(request: Request, {params}: {params:Promise<{shop:string}>}) {
  const {shop} = await params;
  const id = new URL(request.url).searchParams.get("order");
  if (!orderUuid.test(shop) || (id !== null && !orderUuid.test(id))) return new Response(null,{status:400});
  const client = await staffClient(true);
  if (!client) return new Response(null,{status:503});
  const identity = await client.auth.getUser();
  if (identity.error && (!identity.error.status || identity.error.status>=500)) return new Response(null,{status:503});
  if (!identity.data.user?.email_confirmed_at) return new Response(null,{status:401});
  const {data,error} = await client.rpc("vendor_order_feed",{target_shop:shop,selected_order:id ?? undefined});
  if (error) return new Response(null,{status:error.code==="42501" ? 403 : 503});
  return Response.json({orders:data,serverTime:Date.now()},{headers:{"Cache-Control":"private, no-store"}});
}
