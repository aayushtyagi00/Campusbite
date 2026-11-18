import { createHash, timingSafeEqual } from "node:crypto";
import { commerceDb } from "@/lib/commerce";
import { providerPayment, razorpay } from "@/lib/razorpay";
import { liveStudent } from "@/lib/student-auth";

type RefundJob = { id: string; payment: string; amount: number };
const hash = (value: string) => createHash("sha256").update(value).digest();

export async function POST(request: Request) {
  const secret = process.env.COMMERCE_JOB_SECRET?.trim();
  if (!liveStudent() || !secret) return new Response(null, { status: 503 });
  if (!timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash("Bearer " + secret))) {
    return new Response(null, { status: 401 });
  }
  try {
    const db = commerceDb();
    const jobs = await db.rpc("commerce_refund_jobs");
    if (jobs.error) throw jobs.error;
    const results = await Promise.allSettled((jobs.data as RefundJob[]).map(async job => {
      if (!providerPayment.test(job.payment)) throw new Error("Invalid payment reference");
      const path = "/payments/" + job.payment + "/refund";
      const lists = await razorpay(path + "s?count=100");
      let refund = lists.items?.find((item: { receipt?: string }) => item.receipt === job.id);
      refund ??= await razorpay(path, { amount: job.amount, speed: "normal", receipt: job.id }, { "X-Refund-Idempotency": job.id });
      if (refund.amount !== job.amount || refund.payment_id !== job.payment || !["pending", "processed"].includes(refund.status)) {
        throw new Error("Refund requires reconciliation");
      }
      const result = await db.rpc("commerce_record_refund", {
        payment: job.payment, amount: job.amount, outcome: refund.status === "processed" ? "Succeeded" : "Pending",
      });
      if (result.error) throw result.error;
    }));
    const retrying = results.filter(result => result.status === "rejected").length;
    return Response.json({ processed: results.length - retrying, retrying }, { status: retrying ? 502 : 200 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
