import { commerceDb } from "@/lib/commerce";
import { processPaymentWebhook } from "@/lib/payment-webhook";
import { paymentSettings, providerOrder, providerPayment, signed } from "@/lib/razorpay";
import { liveCommerce } from "@/lib/student-auth";

const maxBytes = 262_144;

async function webhookBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!liveCommerce() || !secret) return new Response(null, { status: 503 });
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (signature.length !== 64) return new Response(null, { status: 401 });
  try {
    const raw = await webhookBody(request);
    if (!raw) return new Response(null, { status: 413 });
    if (!signed(raw, signature, secret)) return new Response(null, { status: 401 });
    let event;
    try { event = JSON.parse(raw.toString("utf8")); }
    catch { return new Response(null, { status: 400 }); }
    const kind = event?.event;
    if (kind !== "payment.captured" && kind !== "refund.processed") return new Response(null, { status: 204 });
    const eventId = request.headers.get("x-razorpay-event-id");
    if (!eventId || eventId.length > 190) return new Response(null, { status: 400 });
    const capture = kind === "payment.captured";
    const entity = capture ? event.payload?.payment?.entity : event.payload?.refund?.entity;
    const payment = capture ? entity?.id : entity?.payment_id;
    if (typeof payment !== "string" || !providerPayment.test(payment) || !Number.isSafeInteger(entity?.amount) ||
      entity.amount <= 0 || entity.currency !== "INR" || (capture ?
        entity.status !== "captured" || !providerOrder.test(entity.order_id) :
        entity.status !== "processed" || !/^rfnd_[a-zA-Z0-9]+$/.test(entity.id))) return new Response(null, { status: 400 });
    const settings = await paymentSettings();
    if (!settings) return new Response(null, { status: 503 });
    const db = commerceDb();
    const entry={event_id:"webhook:"+eventId, kind, payment, gateway_order:capture ? entity.order_id : null,
      refund_id:capture ? null : entity.id,amount:entity.amount,mode:settings.mode};
    const saved=await db.from("payment_webhook_queue").upsert(entry,{onConflict:"event_id",ignoreDuplicates:true});
    if (saved.error) throw saved.error;
    const stored=await db.from("payment_webhook_queue").select("*").eq("event_id",entry.event_id).single();
    if (stored.error) throw stored.error;
    if (!stored.data.completed_at && !await processPaymentWebhook(stored.data)) return new Response(null,{status:202});
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
