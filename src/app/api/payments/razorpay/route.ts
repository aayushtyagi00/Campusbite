import { commerceDb } from "@/lib/commerce";
import { processPaymentWebhook } from "@/lib/payment-webhook";
import { paymentSettings, providerOrder, providerPayment, signed } from "@/lib/razorpay";
import { liveCommerce } from "@/lib/student-auth";
import { readLimitedBody } from "@/lib/request-body";

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!liveCommerce() || !secret) return new Response(null, { status: 503 });
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (signature.length !== 64) return new Response(null, { status: 401 });
  try {
    const raw = await readLimitedBody(request, 262_144);
    if (!raw) return new Response(null, { status: 413 });
    if (!signed(raw, signature, secret)) return new Response(null, { status: 401 });
    let event;
    try { event = JSON.parse(raw.toString("utf8")); }
    catch { return new Response(null, { status: 400 }); }
    const kind = event?.event;
    if (kind !== "payment.captured" && kind !== "refund.processed") return new Response(null, { status: 204 });
    const capture = kind === "payment.captured";
    const entity = capture ? event.payload?.payment?.entity : event.payload?.refund?.entity;
    const payment = capture ? entity?.id : entity?.payment_id;
    if (typeof payment !== "string" || payment.length > 80 || !providerPayment.test(payment) || !Number.isSafeInteger(entity?.amount) ||
      entity.amount <= 0 || entity.currency !== "INR" || (capture ?
        entity.status !== "captured" || typeof entity.order_id !== "string" || entity.order_id.length > 80 || !providerOrder.test(entity.order_id) :
        entity.status !== "processed" || typeof entity.id !== "string" || entity.id.length > 80 || !/^rfnd_[a-zA-Z0-9]+$/.test(entity.id))) return new Response(null, { status: 400 });
    const settings = await paymentSettings();
    if (!settings) return new Response(null, { status: 503 });
    const db = commerceDb();
    // Each terminal event belongs to one signed provider entity, across delivery retries.
    const entry={event_id:["entity",settings.mode,kind,entity.id].join(":"), kind, payment, gateway_order:capture ? entity.order_id : null,
      refund_id:capture ? null : entity.id,amount:entity.amount,mode:settings.mode};
    const saved=await db.from("payment_webhook_queue").upsert(entry,{onConflict:"event_id",ignoreDuplicates:true}).select("*");
    if (saved.error) throw saved.error;
    const inserted = saved.data?.[0];
    if (inserted && !await processPaymentWebhook(inserted)) return new Response(null,{status:202});
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
