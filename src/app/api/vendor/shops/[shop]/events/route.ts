import { vendorSession } from "@/lib/staff/vendor-session";
import { orderUuid } from "@/lib/commerce";

export const maxDuration = 60;

export async function GET(request: Request, {params}: {params:Promise<{shop:string}>}) {
  const {shop} = await params;
  if (!orderUuid.test(shop)) return new Response(null,{status:400});
  const session = await vendorSession(true);
  if (!session) return new Response(null,{status:401});
  const {client,email} = session;
  const grant = await client.from("vendor_access").select("role").eq("shop_id",shop).eq("email",email).maybeSingle();
  if (grant.error || !grant.data) return new Response(null,{status:grant.error ? 503 : 403});
  const auth = await client.auth.getSession();
  if (!auth.data.session) return new Response(null,{status:401});
  await client.realtime.setAuth(auth.data.session.access_token);
  const channel = client.channel("vendor-orders-"+crypto.randomUUID(), {config:{postgres_changes_options:{wait:true}}});
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (message:string) => { if (!closed) controller.enqueue(encoder.encode(message+"\n\n")); };
      const heartbeat = setInterval(()=>send(": heartbeat"),15000);
      const timeout = setTimeout(()=>stop(),48000);
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(timeout);
        request.signal.removeEventListener("abort",stop);
        void client.removeChannel(channel).finally(()=>client.realtime.disconnect()).catch(()=>{});
        try { controller.close(); } catch { /* The browser already closed the stream. */ }
      };
      if (request.signal.aborted) { stop(); return; }
      request.signal.addEventListener("abort",stop,{once:true});
      send("retry: 5000");
      channel.on("postgres_changes",{event:"*",schema:"public",table:"vendor_orders",filter:"shop_id=eq."+shop},()=>send("data: change"))
        .subscribe(status=>{
          if (status==="SUBSCRIBED") send("data: connected");
          else if (["TIMED_OUT","CHANNEL_ERROR","CLOSED"].includes(status)) stop();
        });
    },
    cancel() { stop(); },
  });
  return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"private, no-store, no-transform","X-Accel-Buffering":"no"}});
}
