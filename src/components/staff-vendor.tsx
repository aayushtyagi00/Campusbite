import Link from "next/link";
import { money, statuses } from "@/lib/campus";
import { vendorRoles, type VendorOrder, type VendorRole, type VendorSale, type VendorShop } from "@/lib/staff/database";
import { Empty, Status } from "./ui";

const campusDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
});

export function ShopDashboard({ shop, shops, role, orders, sales }: {
  shop: VendorShop; shops: VendorShop[]; role: VendorRole; orders: VendorOrder[]; sales?: VendorSale[];
}) {
  return <>
    <div className="ops-heading"><div><h1>{shop.name}</h1><p>Shop dashboard · Campus times in IST</p></div><Status tone="good">{vendorRoles[role]}</Status></div>
    {shops.length > 1 && <nav aria-label="Your shops" className="chips staff-records">
      {shops.map(item => <Link key={item.id} className={`button compact${item.id === shop.id ? "" : " secondary"}`}
        aria-current={item.id === shop.id ? "page" : undefined} href={`/vendor/dashboard?shop=${item.id}`}>{item.name}</Link>)}
    </nav>}
    <section className="panel panel-pad stack staff-records">
      <h2>Recent shop orders</h2>
      {orders.length ? <ul className="stack">{orders.map(order => <li className="staff-data-row" key={order.id}>
        <strong>{order.reference}</strong><time dateTime={order.pickup_at}>{campusDate.format(new Date(order.pickup_at))}</time><Status>{statuses[order.status]}</Status>
      </li>)}</ul> : <Empty title="No orders recorded for this shop" />}
    </section>
    {sales !== undefined && <section className="panel panel-pad stack staff-records">
      <h2>Recent shop sales</h2>
      {sales.length ? <ul className="stack">{sales.map(sale => <li className="staff-data-row" key={sale.id}>
        <strong>{sale.reference}</strong><time dateTime={sale.recorded_at}>{campusDate.format(new Date(sale.recorded_at))}</time><strong>{money(sale.amount_paise)}</strong>
      </li>)}</ul> : <Empty title="No sales recorded for this shop" />}
    </section>}
  </>;
}
