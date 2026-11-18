import { commerceDb } from "@/lib/commerce";
import { providerOrder, providerPayment, signed } from "@/lib/razorpay";
import { liveCommerce } from "@/lib/student-auth";

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!liveCommerce() || !secret) return new Response(null, { status: 503 });
  const raw = await request.text();
  if (raw.length > 262_144 || !signed(raw, request.headers.get("x-razorpay-signature") ?? "", secret)) {
    return new Response(null, { status: 401 });
  }
  try {
    const event = JSON.parse(raw);
    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (!payment || payment.status !== "captured" || !providerOrder.test(payment.order_id) || !providerPayment.test(payment.id)
        || !Number.isSafeInteger(payment.amount)) return new Response(null, { status: 400 });
      const result = await commerceDb().rpc("commerce_capture", {
        gateway_order: payment.order_id, payment: payment.id, amount: payment.amount, currency: payment.currency,
      });
      if (result.error || !result.data) throw new Error("Payment requires reconciliation");
    }
    if (event.event === "refund.processed") {
      const refund = event.payload?.refund?.entity;
      if (!refund || refund.status !== "processed" || !providerPayment.test(refund.payment_id) || !Number.isSafeInteger(refund.amount))
        return new Response(null, { status: 400 });
      const result = await commerceDb().rpc("commerce_record_refund", { payment: refund.payment_id, amount: refund.amount, outcome: "Succeeded" });
      if (result.error) throw result.error;
    }
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
