import { createHash, timingSafeEqual } from "node:crypto";
import { commerceDb } from "@/lib/commerce";
import { paymentSettings, providerPayment, razorpay } from "@/lib/razorpay";
import { liveCommerce } from "@/lib/student-auth";
import { retryPaymentWebhooks } from "@/lib/payment-webhook";
import { recoverPayments, deliverPush } from "@/lib/commerce-worker";

type RefundJob = { id: string; payment: string; amount: number };
const hash = (value: string) => createHash("sha256").update(value).digest();

export async function POST(request: Request) {
  const secret = process.env.COMMERCE_JOB_SECRET?.trim();
  if (!liveCommerce() || !secret) return new Response(null, { status: 503 });
  if (!timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash("Bearer " + secret))) {
    return new Response(null, { status: 401 });
  }
  const db = commerceDb();
  let runId:string|undefined;
  try {
    const run=await db.from("commerce_worker_runs").insert({}).select("id").single();
    if (run.error) throw run.error;
    runId=run.data.id;
    const settings=await paymentSettings();
    if (!settings) throw new Error("Missing payment configuration");
    const expired = await db.rpc("expire_uncollected");
    if (expired.error) throw expired.error;
    const jobs = await db.rpc("commerce_refund_jobs");
    if (jobs.error) throw jobs.error;
    const results = await Promise.allSettled((jobs.data as RefundJob[]).map(async job => {
      if (!providerPayment.test(job.payment)) throw new Error("Invalid payment reference");
      const path = "/payments/" + job.payment + "/refund";
      const lists = await razorpay(path + "s?count=100");
      let refund = lists.items?.find((item: { receipt?: string }) => item.receipt === job.id);
      refund ??= await razorpay(path, { amount: job.amount, speed: "normal", receipt: job.id }, { "X-Refund-Idempotency": job.id });
      if (refund.amount !== job.amount || refund.currency !== "INR" || refund.payment_id !== job.payment ||
        refund.receipt !== job.id || !/^rfnd_[a-zA-Z0-9]+$/.test(refund.id) || !["pending", "processed"].includes(refund.status)) {
        throw new Error("Refund requires reconciliation");
      }
      const result = await db.rpc("commerce_record_refund", {
        payment: job.payment, amount: job.amount, outcome: refund.status === "processed" ? "Succeeded" : "Pending",
      });
      if (result.error) throw result.error;
      const reference = await db.from("commerce_orders").update({provider_refund:refund.id,refund_error:null}).eq("id",job.id);
      if (reference.error) throw reference.error;
      if (result.data !== true) {
        const { data, error } = await db.from("commerce_orders").select("refund").eq("id",job.id).single();
        if (error || data?.refund !== "Succeeded") throw new Error("Refund requires reconciliation");
      }
    }));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        const saved = await db.from("commerce_orders").update({refund_error:"Refund submission needs review"}).eq("id",jobs.data[index].id).neq("refund","Succeeded");
        if (saved.error) throw saved.error;
      }
    }
    const retrying = results.filter(result => result.status === "rejected").length;
    const [paymentRetries,pushRetries,webhookRetries]=await Promise.all([recoverPayments(settings.mode),deliverPush(),retryPaymentWebhooks(settings.mode)]);
    const summary={processed:results.length-retrying,retrying,paymentRetries,pushRetries,webhookRetries};
    const pending=retrying+paymentRetries+pushRetries+webhookRetries;
    const saved=await db.from("commerce_worker_runs").update({finished_at:new Date().toISOString(),outcome:pending?"retrying":"ok",results:summary}).eq("id",runId);
    if (saved.error) throw saved.error;
    return Response.json(summary,{status:pending ? 502 : 200});
  } catch {
    if (runId) await db.from("commerce_worker_runs").update({finished_at:new Date().toISOString(),outcome:"failed"}).eq("id",runId);
    return new Response(null, { status: 503 });
  }
}
