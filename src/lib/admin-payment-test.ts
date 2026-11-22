"use server";

import { createHmac } from "node:crypto";
import { orderUuid } from "./commerce";
import { adminTestCredentials, findOrCreateRazorpayOrder, providerOrder, providerPayment, signed, verifiedCapture } from "./razorpay";
import { adminSession, allowAttempt } from "./staff/access";
import { staffService } from "./staff/supabase";

const amount = 100;

export async function startAdminPaymentTest(requestId: string) {
  const admin = await adminSession(true);
  if (!admin || typeof requestId !== "string" || !orderUuid.test(requestId)) return { error: "Administrator access required." };
  const credentials = adminTestCredentials();
  if (!credentials) return { error: "Configure the Razorpay test keys for this deployment." };
  const service = staffService();
  if (!service || !await allowAttempt(service, "razorpay-admin-test", admin.email, 20, 3600))
    return { error: "The test could not be started. Please try again later." };
  try {
    const receipt = "cbtest_" + createHmac("sha256",credentials.secret).update(admin.email + "|" + requestId).digest("hex").slice(0,32);
    const order = await findOrCreateRazorpayOrder(receipt, amount, credentials);
    const proof = createHmac("sha256",credentials.secret).update("admin-test|" + admin.email + "|" + order).digest("hex");
    return { order, key: credentials.key, proof, amount };
  } catch { return { error: "Razorpay could not create the test order. Check the Test Mode credentials." }; }
}

export async function confirmAdminPaymentTest(order: string, proof: string, payment: string, signature: string) {
  const admin = await adminSession(true);
  const credentials = adminTestCredentials();
  if (!admin || !credentials || typeof order !== "string" || !providerOrder.test(order) ||
    typeof payment !== "string" || !providerPayment.test(payment) ||
    !signed("admin-test|" + admin.email + "|" + order, proof, credentials.secret) ||
    !signed(order + "|" + payment, signature, credentials.secret)) return { verified: false };
  try { return { verified: await verifiedCapture(order, payment, amount, credentials) }; }
  catch { return { verified: false }; }
}
