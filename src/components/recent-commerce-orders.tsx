import { commerceDb } from "@/lib/commerce";
import { money } from "@/lib/campus";
import { Empty, Notice } from "./ui";

export async function RecentCommerceOrders() {
  try {
    const { data, error } = await commerceDb().from("commerce_orders").select("id,status,amount_paise,refund,support,detail")
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return <section className="panel panel-pad stack">
      <h2>Recent orders and support</h2>
      {!data.length && <Empty title="No orders yet" />}
      {data.map(order => <div key={order.id} className="stack">
        <strong>CB-{order.id.slice(0, 8).toUpperCase()} · {order.detail.name} · {money(order.amount_paise)}</strong>
        <p>{order.status} · Refund {String(order.refund).toLowerCase()}</p>
        {order.support && <p>Support request · {order.support}</p>}
      </div>)}
    </section>;
  } catch {
    return <Notice>Commerce orders are temporarily unavailable.</Notice>;
  }
}
