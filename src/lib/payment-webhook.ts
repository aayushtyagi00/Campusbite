import "server-only";
import { commerceDb } from "./commerce";
import { razorpay, verifiedCapture } from "./razorpay";

type Event = {event_id:string;kind:"payment.captured"|"refund.processed";payment:string;gateway_order:string|null;refund_id:string|null;amount:number;mode:"live"|"test"};

async function apply(event:Event) {
  const db=commerceDb();
  const {kind,payment}=event;
  const capture=kind==="payment.captured";
  let amount = event.amount;
  if (capture) {
    const { data: order, error } = await db.from("commerce_orders").select("provider_payment,amount_paise")
      .eq("provider_order", event.gateway_order!).maybeSingle();
    if (error) throw error;
    if (!order) {
      // An admin test may use the same Test Mode merchant as a staging site.
      const provider = event.mode === "test" ? await razorpay("/orders/" + event.gateway_order!) : null;
      if (provider?.id === event.gateway_order! && /^cbtest_[a-f0-9]{32}$/.test(provider.receipt))
        return;
      throw new Error("Unmatched capture");
    }
    if (order.amount_paise !== event.amount) throw new Error("Unmatched amount");
    if (order.provider_payment !== payment && !await verifiedCapture(event.gateway_order!, payment, order.amount_paise))
      throw new Error("Unconfirmed capture");
  } else {
    const [refund, paid] = await Promise.all([
      razorpay("/refunds/" + event.refund_id!), razorpay("/payments/" + payment),
    ]);
    if (refund.id !== event.refund_id! || refund.payment_id !== payment || refund.amount !== event.amount ||
      refund.currency !== "INR" || refund.status !== "processed") throw new Error("Unconfirmed refund");
    if (paid.id !== payment || paid.currency !== "INR" || paid.status !== "refunded" || paid.refund_status !== "full" ||
      !Number.isSafeInteger(paid.amount) || paid.amount < refund.amount || paid.amount_refunded !== paid.amount)
      throw new Error("Full refund requires reconciliation");
    amount = paid.amount;
  }
  const result = await db.rpc("commerce_apply_razorpay_event", {
    event_id: event.event_id, kind, payment_id: payment, gateway_order: capture ? event.gateway_order! : null,
    amount, currency: "INR", key_mode: event.mode,
  });
  if (result.error || result.data !== true) throw new Error("Event requires reconciliation");
  if (!capture) {
    const saved=await db.from("commerce_orders").update({provider_refund:event.refund_id!,refund_error:null}).eq("provider_payment",payment);
    if (saved.error) throw saved.error;
  }
}

export async function processPaymentWebhook(event:Event) {
  const db=commerceDb();
  try {
    await apply(event);
    const result=await db.from("payment_webhook_queue").update({completed_at:new Date().toISOString(),error:null}).eq("event_id",event.event_id);
    if (result.error) throw result.error;
    return true;
  } catch {
    const result=await db.from("payment_webhook_queue").update({error:"Provider verification or order matching needs review"}).eq("event_id",event.event_id).is("completed_at",null);
    if (result.error) throw result.error;
    return false;
  }
}

export async function retryPaymentWebhooks(mode:"test"|"live") {
  const {data,error}=await commerceDb().rpc("claim_payment_webhooks",{key_mode:mode});
  if (error) throw error;
  const results=await Promise.allSettled(data.map(processPaymentWebhook));
  return results.filter(result=>result.status==="rejected" || !result.value).length;
}
