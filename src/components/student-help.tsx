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
        <p>Select an available 10-minute pickup window at checkout. Track your order in My Orders and show your six-digit pickup code at the stall once it’s ready.</p>
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
    </>}
  </article>;
}
