import { commerceDb } from "@/lib/commerce";
import { paymentSettings, providerOrder, providerPayment, razorpay, signed, verifiedCapture } from "@/lib/razorpay";
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
    if (capture) {
      const { data: order, error } = await db.from("commerce_orders").select("provider_payment,amount_paise")
        .eq("provider_order", entity.order_id).maybeSingle();
      if (error) throw error;
      if (!order) {
        // An admin test may use the same Test Mode merchant as a staging site.
        const provider = settings.mode === "test" ? await razorpay("/orders/" + entity.order_id) : null;
        if (provider?.id === entity.order_id && /^cbtest_[a-f0-9]{32}$/.test(provider.receipt))
          return new Response(null, { status: 204 });
        throw new Error("Unmatched capture");
      }
      if (order.amount_paise !== entity.amount) throw new Error("Unmatched amount");
      if (order.provider_payment !== payment && !await verifiedCapture(entity.order_id, payment, order.amount_paise))
        throw new Error("Unconfirmed capture");
    } else {
      const refund = await razorpay("/refunds/" + entity.id);
      if (refund.id !== entity.id || refund.payment_id !== payment || refund.amount !== entity.amount ||
        refund.currency !== "INR" || refund.status !== "processed") throw new Error("Unconfirmed refund");
    }
    const result = await db.rpc("commerce_apply_razorpay_event", {
      event_id: "webhook:" + eventId, kind, payment_id: payment, gateway_order: capture ? entity.order_id : null,
      amount: entity.amount, currency: "INR", key_mode: settings.mode,
    });
    if (result.error || result.data !== true) throw new Error("Event requires reconciliation");
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
