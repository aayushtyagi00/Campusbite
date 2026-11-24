import "server-only";
import { sendNotification } from "web-push";
import { commerceDb } from "./commerce";
import { providerOrder, providerPayment, razorpay } from "./razorpay";

export async function recoverPayments(mode:"test"|"live") {
  const db=commerceDb();
  const jobs=await db.rpc("claim_payment_recovery");
  if (jobs.error) throw jobs.error;
  const results=await Promise.all(jobs.data.map(async (order:{id:string;provider_order:string;amount_paise:number})=>{
    try {
      if (!providerOrder.test(order.provider_order)) throw new Error();
      const response=await razorpay("/orders/"+order.provider_order+"/payments");
      if (!Array.isArray(response.items)) throw new Error();
      let latest:{status:string;created_at:number}|undefined;
      for (const payment of response.items) {
        if (!providerPayment.test(payment.id) || payment.order_id!==order.provider_order ||
          payment.amount!==order.amount_paise || payment.currency!=="INR") throw new Error();
        if (!latest || payment.created_at>latest.created_at) latest=payment;
        const attempt=await db.from("commerce_payment_attempts").upsert({
          order_id:order.id,payment_id:payment.id,status:payment.status,amount:payment.amount,updated_at:new Date().toISOString(),
        },{onConflict:"payment_id"});
        if (attempt.error) throw attempt.error;
        if (payment.status==="captured" && payment.captured===true && payment.amount_refunded===0) {
          const applied=await db.rpc("commerce_apply_razorpay_event",{event_id:"recovery:"+payment.id,kind:"payment.captured",
            payment_id:payment.id,gateway_order:order.provider_order,amount:payment.amount,currency:"INR",key_mode:mode});
          if (applied.error || !applied.data) throw new Error();
        }
      }
      if (latest) {
        const state=await db.from("commerce_orders").update({latest_payment_attempt:latest.status}).eq("id",order.id).is("provider_payment",null);
        if (state.error) throw state.error;
      }
      const saved=await db.from("commerce_orders").update({recovery_error:null}).eq("id",order.id).eq("recovery_error","Payment verification requires review");
      if (saved.error) throw saved.error;
      return true;
    } catch {
      const saved=await db.from("commerce_orders").update({recovery_error:"Payment verification requires review"}).eq("id",order.id);
      if (saved.error) throw saved.error;
      return false;
    }
  }));
  return results.filter(ok=>!ok).length;
}

export async function deliverPush() {
  const publicKey=process.env.NEXT_PUBLIC_VAPID_KEY,privateKey=process.env.VAPID_PRIVATE_KEY,subject=process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return 0;
  const db=commerceDb();
  const jobs=await db.rpc("claim_order_push");
  if (jobs.error) throw jobs.error;
  const results=await Promise.allSettled(jobs.data.map(async (job:{id:number;lease:string;endpoint:string;keys:{auth:string;p256dh:string};body:string;audience:string})=>{
    let problem=null;
    try {
      await sendNotification({endpoint:job.endpoint,keys:job.keys},JSON.stringify({body:job.body,audience:job.audience}),
        {TTL:60,timeout:5000,vapidDetails:{subject,publicKey,privateKey}});
    } catch(error) {
      const status=(error as {statusCode?:number}).statusCode;
      if (status===410 || status===404) {
        const removed=await db.from("push_subscriptions").delete().eq("endpoint",job.endpoint);
        if (removed.error) throw removed.error;
        return;
      }
      problem="Delivery unavailable";
    }
    const saved=await db.rpc("finish_order_push",{job:job.id,claim:job.lease,problem});
    if (saved.error || problem) throw new Error("Notification retry scheduled");
  }));
  return results.filter(result=>result.status==="rejected").length;
}
