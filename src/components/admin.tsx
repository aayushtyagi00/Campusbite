"use client";

import Link from "next/link";
import { ArrowRight, CircleDollarSign, ClipboardList, Store, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { clockTime, money, slotLabel, statuses, type Order, type Stall } from "@/lib/campus";
import { resetPreview, update, useOrderExpiry, usePreview, visibleStatus } from "@/lib/preview";
import { Empty, Notice, Status } from "./ui";

type Section = "overview" | "vendors" | "orders" | "refunds" | "finance" | "settings";
const headings: Record<Section, [string, string]> = {
  overview: ["Operations overview", "UniMall Food Court · Campus pickup pilot"],
  vendors: ["Vendor management", "Review applications and manage stall access."],
  orders: ["Order investigation", "Search by order reference or stall and review the timeline."],
  refunds: ["Refund queue", "Review refund requests separately from fulfillment."],
  finance: ["Reconciliation", "Review simulated receipts and refund totals."],
  settings: ["Pilot settings", "Manage the ordering pause and review the current pilot rules."],
};
export function Admin({ section }: { section: string }) {
  const data = usePreview();
  const now = useOrderExpiry();
  const [title, description] = headings[section as Section];
  const refunds = data.orders.filter(order => order.refund !== "None");
  const reviewCount = data.applications.filter(application => ["Submitted", "Under review"].includes(application.status)).length;
  return <>
    <div className="ops-heading"><div><h1>{title}</h1><p>{description}</p></div>
      <Status tone={data.orderingPaused ? "warn" : "good"}>{data.orderingPaused ? "Ordering paused" : "Ordering enabled"}</Status>
    </div>
    {section === "overview" && <>
      <div className="metrics">
        <Metric href="/admin/orders" title="Orders" value={data.orders.length} icon={ClipboardList} />
        <Metric href="/admin/vendors" title="Vendors awaiting review" value={reviewCount} icon={Store} />
        <Metric href="/admin/refunds" title="Open refunds" value={refunds.filter(order => order.refund !== "Succeeded").length} icon={TriangleAlert} />
        <Metric href="/admin/finance" title="Simulated captured value" value={money(data.orders.reduce((sum, order) => sum + order.total, 0))} icon={CircleDollarSign} />
      </div>
      <div className="section-head"><h2>Recent orders</h2><Link className="text-link row" href="/admin/orders">All orders <ArrowRight size={16} /></Link></div>
      <OrderList orders={data.orders.slice(0, 5)} now={now} />
    </>}
    {section === "vendors" && <Vendors />}
    {section === "orders" && <Investigate orders={data.orders} now={now} />}
    {section === "refunds" && <Refunds orders={refunds} />}
    {section === "finance" && <Finance orders={data.orders} />}
    {section === "settings" && <div className="stack ops-form">
      <section className="panel panel-pad stack">
        <h2>Campus ordering pause</h2>
        <p>New preview orders pause across all stalls. Existing orders can still be fulfilled.</p>
        <button className="button secondary" onClick={() => update(current => ({ ...current, orderingPaused: !current.orderingPaused }))}>{data.orderingPaused ? "Resume campus ordering" : "Pause campus ordering"}</button>
      </section>
      <section className="panel panel-pad stack"><h2>Pickup and pricing</h2>
        <p>10-minute pickup windows · 90-second acceptance deadline · 8 items per bag</p>
        <p>Fee amounts, taxes and post-acceptance cancellation terms are pending business decisions.</p>
      </section>
      <section className="panel panel-pad stack"><h2>Sample data</h2>
        <p>Restart the campus day and clear local preview orders, applications and menu edits.</p>
        <button className="button secondary" onClick={() => {
          if (window.confirm("Reset all CampusBite sample data in this browser?")) resetPreview();
        }}>Reset preview data</button>
      </section>
    </div>}
  </>;
}
function Metric({ href, title, value, icon: Icon }: { href: string; title: string; value: string | number; icon: typeof Store }) {
  return <Link className="panel panel-pad metric" href={href}><span className="metric-icon"><Icon size={19} /></span><p>{title}</p><strong>{value}</strong><ArrowRight className="metric-arrow" size={17} /></Link>;
}
function Vendors() {
  const data = usePreview();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  function review(email: string, status: Stall["approval"]) {
    if (status === "Changes requested" && !note.trim()) {
      setMessage("Add a review note so the vendor knows what to correct.");
      return;
    }
    update(current => ({ ...current, applications: current.applications.map(item => item.email === email ? { ...item, status, note: note.trim() } : item) }));
    setNote("");
    setMessage(`Application updated to ${status.toLowerCase()}.`);
  }
  return <div className="stack">
    <h2>Applications</h2>
    {message && <Notice>{message}</Notice>}
    {!data.applications.length && <Empty title="No applications submitted" />}
    {data.applications.map(item => <article className="panel panel-pad stack" key={item.email}>
      <div className="row between"><h3>{item.name}</h3><Status tone={item.status === "Approved" ? "good" : "warn"}>{item.status}</Status></div>
      <p>{item.owner} · {item.email}</p><p>{item.location} · {item.cuisine}</p>
      {item.license && <p>Registration · {item.license}</p>}
      {item.note && <p>Review note · {item.note}</p>}
      {["Submitted", "Under review"].includes(item.status) && <>
        <label className="field">Review note<textarea maxLength={240} value={note} onChange={event => setNote(event.target.value)} /></label>
        <div className="row wrap-row">
          {item.status === "Submitted" && <button className="button secondary" onClick={() => review(item.email, "Under review")}>Start review</button>}
          <button className="button" onClick={() => review(item.email, "Approved")}>Approve application</button>
          <button className="button secondary" onClick={() => review(item.email, "Changes requested")}>Request changes</button>
          <button className="button secondary" onClick={() => review(item.email, "Rejected")}>Reject</button>
        </div>
      </>}
      {item.status === "Approved" && <p>Order activation still requires payment onboarding, menu and hours.</p>}
    </article>)}
    <h2>Pilot stalls</h2>
    {data.stalls.map(stall => <article className="panel panel-pad row between wrap-row" key={stall.id}>
      <div><strong>{stall.name}</strong><p>{stall.location}</p></div>
      <div className="row"><Status tone={stall.approval === "Approved" ? "good" : "warn"}>{stall.approval}</Status>
        <button className="button secondary compact" onClick={() => update(current => ({
          ...current, stalls: current.stalls.map(item => item.id === stall.id ? { ...item, approval: item.approval === "Approved" ? "Suspended" : "Approved" } : item),
        }))}>{stall.approval === "Approved" ? "Suspend" : "Restore"}</button>
      </div>
    </article>)}
  </div>;
}
function Investigate({ orders, now }: { orders: Order[]; now: number }) {
  const [query, setQuery] = useState("");
  return <div className="stack">
    <label className="field ops-form">Search orders<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Order reference or stall name" /></label>
    <OrderList now={now} orders={orders.filter(order => `${order.id} ${order.name}`.toLowerCase().includes(query.trim().toLowerCase()))} />
  </div>;
}
function OrderList({ orders, now }: { orders: Order[]; now: number }) {
  if (!orders.length) return <Empty title="No matching orders" />;
  return <div className="stack">{orders.map(order => <details className="panel panel-pad ops-details" key={order.id}>
    <summary><strong>{order.id}</strong><span>{order.name}</span><Status tone="good">{statuses[visibleStatus(order, now)]}</Status><strong>{money(order.total)}</strong></summary>
    <div className="stack"><p>{order.student} · {order.location} · {slotLabel(order.slot)}</p>
      <p>Payment · Demo verified &nbsp; Refund · {order.refund}</p>
      <ul>{order.items.map((item, index) => <li key={index}>{item.qty} × {item.name} · {money(item.price * item.qty)}</li>)}</ul>
      <h3>Order timeline</h3>{order.events.map((event, index) => <div className="row between" key={index}><span>{event.status}</span><time>{clockTime(event.at)}</time></div>)}
      <SupportCase id={order.id} />
    </div>
  </details>)}</div>;
}
function SupportCase({ id }: { id: string }) {
  const data = usePreview();
  const support = data.support.find(item => item.order === id);
  if (!support) return null;
  return <div className="stack">
    <h3>Support case</h3><p>{support.issue}</p>
    {support.resolution ? <p>Resolution · {support.resolution}</p> : <form className="stack" onSubmit={event => {
      event.preventDefault();
      const note = String(new FormData(event.currentTarget).get("resolution")).trim();
      if (note) update(current => ({ ...current, support: current.support.map(item => item.order === id ? { ...item, resolution: note } : item) }));
    }}><label className="field">Resolution note<textarea name="resolution" required maxLength={300} /></label><button className="button secondary">Resolve sample case</button></form>}
  </div>;
}
function Refunds({ orders }: { orders: Order[] }) {
  function mark(order: Order, refund: Order["refund"]) {
    update(current => ({ ...current, orders: current.orders.map(item => item.id === order.id && item.refund === order.refund ? { ...item, refund } : item) }));
  }
  return <div className="stack">
    <Notice>Refund actions below simulate provider updates. No funds move.</Notice>
    {!orders.length && <Empty title="No refund requests" />}
    {orders.map(order => <article className="panel panel-pad stack" key={order.id}>
      <div className="row between wrap-row"><strong>{order.id} · {order.name}</strong><Status tone={order.refund === "Succeeded" ? "good" : "warn"}>{order.refund}</Status></div>
      <p>{statuses[order.status]} · Full refund of {money(order.total)}</p>
      {order.refund === "Requested" && <button className="button secondary" onClick={() => mark(order, "Pending")}>Simulate refund submission</button>}
      {order.refund === "Pending" && <button className="button secondary" onClick={() => mark(order, "Succeeded")}>Simulate provider confirmation</button>}
    </article>)}
  </div>;
}
function Finance({ orders }: { orders: Order[] }) {
  const refunded = orders.filter(order => order.refund === "Succeeded").reduce((sum, order) => sum + order.total, 0);
  const pending = orders.filter(order => ["Requested", "Pending"].includes(order.refund)).reduce((sum, order) => sum + order.total, 0);
  const captured = orders.reduce((sum, order) => sum + order.total, 0);
  return <div className="stack">
    <div className="metrics">{[["Simulated captured", captured], ["Open refunds", pending], ["Simulated refunds completed", refunded]].map(([label, total]) => <div className="panel panel-pad" key={label}><p>{label}</p><h2>{money(Number(total))}</h2></div>)}</div>
    <Empty title="Provider reconciliation pending"><p>Settlement records and mismatches will appear after the payment provider and ledger are connected.</p></Empty>
  </div>;
}
