import { orderUuid } from "@/lib/commerce";

export async function GET(_: Request, { params }: { params: Promise<{shop:string;file:string}> }) {
  const {shop,file} = await params;
  if (!orderUuid.test(shop) || !/^[\da-f-]{36}\.(jpg|png|webp)$/.test(file) || !process.env.SUPABASE_URL) return new Response(null,{status:404});
  return Response.redirect(new URL("/storage/v1/object/public/menu-photos/"+shop+"/"+file,process.env.SUPABASE_URL),307);
}
