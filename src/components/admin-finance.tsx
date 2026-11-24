import Link from "next/link";
import { commerceDb } from "@/lib/commerce";
import { money } from "@/lib/campus";
import { Notice } from "./ui";

const labels:Record<string,string>={capture:"Payment",refund:"Refund",extra_capture:"Extra payment",extra_refund:"Extra payment refunded"};

export async function AdminFinance({page}:{page:number}) {
  const db=commerceDb();
  const size=25,from=(page-1)*size;
  const [entries,webhooks,runs,metrics]=await Promise.all([
    db.from("payment_journal").select("id,order_id,kind,payment,amount_paise,recorded_at").order("id",{ascending:false}).range(from,from+size),
    db.from("payment_webhook_queue").select("event_id,payment,error,attempts,due").not("error","is",null).is("completed_at",null).order("due").limit(25),
    db.from("commerce_worker_runs").select("started_at,finished_at,outcome").order("started_at",{ascending:false}).limit(1),
    db.rpc("commerce_ops_metrics"),
  ]);
  if (entries.error || webhooks.error || runs.error || metrics.error) return <Notice>Could not load payment records.</Notice>;
  const latest=runs.data[0];
  return <div className="stack"><section className="panel panel-pad stack">
    <h1>Payment journal</h1><p>Customer payments and refunds in INR. Vendor settlements await the platform fee agreement.</p>
    {entries.data.slice(0,size).map(row=><div key={row.id} className="staff-data-row">
      <Link className="text-link" href={"/admin/orders?reference="+row.order_id}>CB-{row.order_id.slice(0,8).toUpperCase()}</Link>
      <span>{labels[row.kind]} · {row.payment}</span><strong>{money(row.amount_paise)}</strong>
    </div>)}
    {!entries.data.length && <p>No recorded payments.</p>}
    <nav className="row">{page>1 && <Link href={"/admin/finance?page="+(page-1)}>Previous</Link>}
      {entries.data.length>size && <Link href={"/admin/finance?page="+(page+1)}>Next</Link>}</nav>
  </section><section className="panel panel-pad stack"><h2>Payment operations</h2>
    <p>Last seven days · {metrics.data.paid} paid · {metrics.data.accepted} accepted · {metrics.data.missed} missed acceptances · {metrics.data.uncollected} uncollected.</p>
    {metrics.data.accepted_due>0 && <p>{metrics.data.on_time_due} of {metrics.data.accepted_due} accepted orders with elapsed windows were ready on time.</p>}
    {metrics.data.failed_push>0 && <p>{metrics.data.failed_push} notifications exhausted their delivery retries.</p>}
    <p>{latest ? "Last worker run · "+latest.started_at+" · "+latest.outcome : "Waiting for the first scheduled worker run."}</p>
    <Link className="text-link" href="/admin/orders?view=exceptions">Orders requiring payment review</Link>
    {webhooks.data.length>0 && <h3>Unresolved webhook deliveries</h3>}
    {webhooks.data.map(event=><p key={event.event_id}>{event.payment} · {event.error} · {event.attempts} scheduled attempts</p>)}
  </section></div>;
}
