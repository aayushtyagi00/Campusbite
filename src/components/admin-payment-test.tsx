"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import { startAdminPaymentTest, confirmAdminPaymentTest } from "@/lib/admin-payment-test";

type Checkout = new (options: {
  key: string; order_id: string; amount: number; currency: string; name: string;
  modal: { ondismiss: () => void };
  handler: (response: { razorpay_payment_id: string; razorpay_signature: string }) => void;
}) => { open(): void };

export function AdminPaymentTest({ configured }: { configured: boolean }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef("");
  async function run() {
    setBusy(true);
    setMessage("");
    try {
      request.current ||= crypto.randomUUID();
      const result = await startAdminPaymentTest(request.current);
      if (!result.order) throw new Error(result.error ?? "Test order unavailable.");
      const { order, proof, key, amount } = result;
      const Razorpay = (window as Window & { Razorpay?: Checkout }).Razorpay;
      if (!Razorpay) throw new Error("Reload the page to load Razorpay Checkout.");
      new Razorpay({ key, order_id: order, amount, currency: "INR", name: "CampusBite · Test payment",
        modal: { ondismiss: () => { setMessage("Checkout closed."); setBusy(false); } },
        handler: async response => {
          try {
            const check = await confirmAdminPaymentTest(order, proof, response.razorpay_payment_id, response.razorpay_signature);
            setMessage(check.verified ? "Verified ₹1 test payment · " + response.razorpay_payment_id :
              "Capture is unconfirmed. Check this order in the Razorpay Test Mode dashboard: " + order);
          } catch { setMessage("Verification unavailable. Check this order in the Razorpay Test Mode dashboard: " + order); }
          finally { request.current = ""; setBusy(false); }
        },
      }).open();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open test checkout.");
      setBusy(false);
    }
  }
  return <section className="panel panel-pad stack">
    <h1>Test a Razorpay payment</h1>
    <p>Try a simulated ₹1 payment using Razorpay Test Mode. This check has no effect on student orders, vendor earnings or pickup queues.</p>
    {configured ? <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" onReady={() => setReady(true)} onError={() => setMessage("Razorpay Checkout could not load. Reload to retry.")} />
      <button className="button" disabled={!ready || busy} onClick={run}>{busy ? "Testing payment…" : "Test ₹1 payment"}</button>
    </> : <p>Set RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET in the hosting environment and redeploy to enable this test.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
