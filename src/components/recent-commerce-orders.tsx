import Link from "next/link";
import { commerceDb, orderUuid } from "@/lib/commerce";
import { money, clockTime, dateLabel } from "@/lib/campus";
import { changeOrderingPause, reviewCase } from "@/lib/admin-order-actions";
import { StaffForm } from "./staff-forms";
import { Empty, Notice } from "./ui";

export async function RecentCommerceOrders({ reference="", view="all" }: {reference?:string;view?:string}) {
  const term = reference.trim().replace(/^CB-/i,"").toLowerCase();
  const short = /^[a-f0-9]{8}$/.test(term);
  try {
    const db = commerceDb();
    let query = db.from("commerce_orders").select("id,student_id,status,amount_paise,refund,support,support_state,support_revision,support_reply,support_owner,detail,provider_order,provider_payment,provider_refund,recovery_error,recovery_count,refund_error,events,created_at,collected_at,collected_by")
      .order("created_at",{ascending:false}).limit(50);
    if (short) query = query.gte("id",term+"-0000-0000-0000-000000000000").lte("id",term+"-ffff-ffff-ffff-ffffffffffff");
    else if (orderUuid.test(term)) query=query.eq("id",term);
    else if (/^pay_[a-z0-9]+$/i.test(reference.trim())) query=query.eq("provider_payment",reference.trim());
    else if (/^order_[a-z0-9]+$/i.test(reference.trim())) query=query.eq("provider_order",reference.trim());
    else if (/^rfnd_[a-z0-9]+$/i.test(reference.trim())) query=query.eq("provider_refund",reference.trim());
    else if (term) return <Notice>Enter a CB reference, full order ID, or Razorpay order, payment or refund ID. <Link href="/admin/orders">Search again</Link></Notice>;
    if (view==="overdue") query=query.in("refund",["Requested","Pending"]).lt("refund_requested_at",new Date(Date.now()-48*3600000).toISOString());
    if (view==="exceptions") query=query.or("recovery_error.not.is.null,refund_error.not.is.null");
    if (view==="refunds") query=query.neq("refund","None");
    if (view==="support") query=query.not("support","is",null);
    const [orders,control]=await Promise.all([query,db.from("ordering_control").select("paused").single()]);
    if (orders.error || control.error) throw new Error("Operations unavailable");
    return <section className="panel panel-pad stack">
      <form action={changeOrderingPause.bind(null,!control.data.paused)}>
        <button className="button secondary">{control.data.paused?"Resume campus checkout":"Pause new campus orders"}</button>
      </form>
      <form className="row wrap-row" action="/admin/orders">
        <label className="field">Order or Razorpay reference<input name="reference" defaultValue={reference} placeholder="CB-1234ABCD" /></label>
        <label className="field">Show<select name="view" defaultValue={view}><option value="all">All orders</option><option value="support">Support requests</option><option value="refunds">Refunds</option><option value="overdue">Refunds pending over 48 hours</option><option value="exceptions">Payment issues</option></select></label>
        <button className="button">Search</button>
      </form>
      {!orders.data.length && <Empty title="No matching orders" />}
      {orders.data.map(order=><details className="stack" key={order.id}>
        <summary>CB-{order.id.slice(0,8).toUpperCase()} · {order.detail.name} · {money(order.amount_paise)} · {order.status}</summary>
        <p>Student account · {order.student_id}</p><p>Gateway order · {order.provider_order ?? "Pending"}<br/>Payment · {order.provider_payment ?? "Pending"}<br/>Refund · {order.refund} {order.provider_refund}</p>
        {order.refund_error && <p>{order.refund_error}</p>}
        {order.recovery_error && <p>{order.recovery_error} · {order.recovery_count} recovery checks</p>}
        {order.collected_at && <p>Collected · {order.collected_at} · {order.collected_by}</p>}
        <ul>{order.events.map((event:{status:string;at:number},index:number)=><li key={index}>{dateLabel(event.at)} {clockTime(event.at)} · {event.status}</li>)}</ul>
        <p>{order.support ?? "No student complaint"} · {order.support_state} · {order.support_owner ?? "Unassigned"}</p>
        <StaffForm action={reviewCase.bind(null,order.id,order.support_revision)} label="Save case decision">
          <label className="field">Case status<select name="state" defaultValue={order.support_state}><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
          <label className="field">Reply to student<textarea name="reply" required maxLength={1000} defaultValue={order.support_reply ?? ""} /></label>
          {order.provider_payment && order.refund==="None" && <label><input type="checkbox" name="refund" /> Request a full refund and cancel any remaining fulfillment</label>}
        </StaffForm>
      </details>)}
    </section>;
  } catch { return <Notice>Commerce operations could not be loaded. Verify the order operations migration and database connection.</Notice>; }
}
