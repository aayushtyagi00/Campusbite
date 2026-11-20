import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Back } from "./ui";

const pages = {
  support: {
    title: "Support",
    intro: "Find your pickup details or get help with a CampusBite order.",
  },
  "pickup-refunds": {
    title: "Pickup & Refunds",
    intro: "How pickup windows, cancellation, and refund status work.",
  },
  "privacy-policy": {
    title: "Privacy Policy",
    intro: "How CampusBite handles your information.",
  },
  "terms-of-service": {
    title: "Terms of Service",
    intro: "These terms apply when you use CampusBite to order food for campus pickup or manage a participating shop.",
  },
} as const;

export function StudentHelp({ section }: { section: keyof typeof pages }) {
  const page = pages[section];
  return <article className="narrow help-page">
    <Back href="/">Home</Back>
    <header className="page-heading"><h1>{page.title}</h1><p>{page.intro}</p></header>
    {section === "support" && <>
      <section className="panel panel-pad stack">
        <h2>Help with an order</h2>
        <p>Open My Orders, select the order, and use the Order Support form. You can also check your pickup time, order status, and any refund updates on that page.</p>
        <Link className="button" href="/orders">Open My Orders <ArrowRight size={17} /></Link>
      </section>
      <section className="panel panel-pad stack">
        <h2>Common questions</h2>
        <details><summary>When can I pick up my order?</summary><p>Check the status of your order and head to the stall when it’s marked ready. Your pickup code appears in the order details.</p></details>
        <details><summary>How do I find the vendor?</summary><p>Check the food court and stall location listed in your order details.</p></details>
        <Link className="text-link" href="/pickup-refunds">Read the pickup and refund guide</Link>
      </section>
    </>}
    {section === "pickup-refunds" && <>
      <section className="panel panel-pad stack">
        <h2>Pickup windows</h2>
        <p>Select an available pickup window at checkout. Track your order in My Orders and show your six-digit pickup code at the stall once it’s ready.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Cancellation and refunds</h2>
        <p>While the vendor is deciding whether to accept, you can cancel from your order details. A cancellation, vendor rejection, or expired acceptance window creates a refund request for a paid order.</p>
        <p>Refunds go back through Razorpay. Check My Orders for the current status.</p>
        <Link className="text-link" href="/support">Get help with an order</Link>
      </section>
    </>}
    {section === "privacy-policy" && <>
      <section className="panel panel-pad stack">
        <h2>When you sign in with Google</h2>
        <p>Google shares your Google account identifier, email address and basic profile with Supabase, which handles sign-in for CampusBite. Your basic profile can include your name and profile picture. Supabase stores the sign-in details with your CampusBite account so it can recognize you on your next visit.</p>
        <p>CampusBite uses your account ID to link you to your orders and support requests. If you use a vendor or administrator account, CampusBite also checks your verified email against the access granted to you. Signing in alone does not give someone access to a shop.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Browser storage</h2>
        <p>CampusBite stores your cart and selected food court in your browser. A session cookie keeps you signed in.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Accounts, orders and payments</h2>
        <p>Supabase manages student sign-in. CampusBite stores order and support records under your account and shares preparation details with the shop fulfilling the order. Razorpay handles payment details. CampusBite records payment references and refund status.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Public reviews</h2>
        <p>The server saves the display name, star rating, review text, and time of each submission. Other visitors to the same site can see those details on the homepage. Leave out personal contact details and order codes.</p>
        <p>Clearing browser data does not remove a published review from the server.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Vendor applications and staff access</h2>
        <p>CampusBite administrators can review the shop and contact details submitted through the vendor form. For approved accounts, CampusBite stores the authorized email, shop, and role and records access changes.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Your Google connection and stored records</h2>
        <p>You can remove CampusBite from your <a className="text-link" href="https://myaccount.google.com/connections">Google Account connections</a> at any time. This stops future access through that connection. Account information and past orders already stored by CampusBite are separate records.</p>
        <p>To ask about your data or request account deletion, email <a className="text-link" href="mailto:tyagiaayush3030@gmail.com">tyagiaayush3030@gmail.com</a> from the address linked to your CampusBite account. For a question about a specific order, open that order in My Orders and choose Order Support.</p>
      </section>
    </>}
    {section === "terms-of-service" && <>
      <section className="panel panel-pad stack">
        <h2>Your account</h2>
        <p>Use an account you control and keep your password, verification codes and pickup codes private. If you manage a shop, use your assigned role only for that shop’s orders, menu and team.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Ordering and pickup</h2>
        <p>Before paying, check the shop, items, total price and pickup window shown at checkout. Razorpay processes online payments. The shop confirms whether it can prepare your order. You can follow its decision and preparation status in My Orders.</p>
        <p>When the shop marks your order ready, go to the listed stall and show your pickup code to collect it. If you have a food allergy, check ingredients and preparation with the shop before ordering.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Cancellations, refunds and order problems</h2>
        <p>You can cancel in My Orders while the shop is deciding whether to accept. If you cancel during that window, the shop rejects the order, or its acceptance window expires, CampusBite requests a full refund for a paid order. You can track the refund status in the order details.</p>
        <p>For a missing item, an incorrect order or a payment problem, open the order and use Order Support. See the <Link className="text-link" href="/pickup-refunds">pickup and refund guide</Link> for details.</p>
      </section>
      <section className="panel panel-pad stack">
        <h2>Using CampusBite responsibly</h2>
        <p>Place genuine orders, use only payment methods you are authorized to use and post reviews based on your own experience. Keep other people’s personal information out of public reviews.</p>
        <p>Read the <Link className="text-link" href="/privacy-policy">Privacy Policy</Link> for details about sign-in, payments and public reviews. For help using CampusBite, visit <Link className="text-link" href="/support">Support</Link>.</p>
      </section>
    </>}
  </article>;
}
