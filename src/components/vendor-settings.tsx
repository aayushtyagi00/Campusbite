import Link from "next/link";
import { WeekdayHours } from "./weekday-hours";
import { weekdays, clockTime, dateLabel, money } from "@/lib/campus";
import { applicationStatuses, type Storefront } from "@/lib/staff/database";
import type { staffSession } from "@/lib/staff/supabase";
import { saveAvailability, savePickupPolicy } from "@/lib/vendor-fulfillment";
import { orderUuid } from "@/lib/commerce";
import { StaffForm } from "./staff-forms";
import { Notice } from "./ui";

type Client = NonNullable<Awaited<ReturnType<typeof staffSession>>>["client"];

export function Availability({shop,store}:{shop:string;store:Storefront}) {
  return <section className="panel panel-pad stack ops-form">
    <h2>Hours and pickup limits</h2><p>Set regular hours in campus time (IST), then choose any weekday exceptions. A closing time earlier than opening ends the shift the next day. For half past midnight enter 00:30.</p>
    <StaffForm action={saveAvailability.bind(null,shop,store.revision)} label="Save availability">
      <div className="form-grid">
        <label className="field">Opens at<input type="time" name="opening" required defaultValue={store.opens?.slice(0,5)} /></label>
        <label className="field">Closes at<input type="time" name="closing" required defaultValue={store.closes?.slice(0,5)} /></label>
        <label className="field">Orders per pickup window<input type="number" name="slots" min="1" max="100" required defaultValue={store.capacity} /></label>
        <label className="field">Pickup window (minutes)<input name="minutes" type="number" min="1" max="60" required defaultValue={store.pickup_minutes ?? 10} /></label>
        <label className="field">Maximum items per order<input name="basket" type="number" min="1" max="8" required defaultValue={store.basket_limit} /></label>
      </div>
      <section className="stack"><h3>Weekly schedule</h3>{weekdays.map(day => <WeekdayHours key={day} day={day} hours={store.weekly_hours?.[day]}
        regular={{opens:store.opens?.slice(0,5) ?? "",closes:store.closes?.slice(0,5) ?? ""}} />)}</section>
      <label className="field">Closure dates<textarea name="closures" placeholder="YYYY-MM-DD, YYYY-MM-DD" defaultValue={store.closed_dates.join(", ")} /></label>
      <label className="row"><input type="checkbox" name="paused" defaultChecked={store.vendor_paused} /> Pause new orders</label>
      <p className="fineprint">You can still fulfill paid orders while the shop is paused.</p>
    </StaffForm>
    <h3>Pickup timing</h3>
    <StaffForm action={savePickupPolicy.bind(null,shop,store.revision)} label="Save pickup timing">
      <div className="form-grid">
        <label className="field">Book ahead (minutes)<input type="number" name="advance" min="15" max="360" required defaultValue={store.advance_minutes ?? 60} /></label>
        <label className="field">Accept a paid order within (seconds)<input type="number" name="acceptance" min="30" max="300" required defaultValue={store.acceptance_seconds ?? 90} /></label>
        <label className="field">Extra preparation buffer (minutes)<input type="number" name="buffer" min="0" max="30" required defaultValue={store.buffer_minutes ?? 2} /></label>
        <label className="field">Finish pickups before closing (minutes)<input type="number" name="cutoff" min="0" max="180" required defaultValue={store.last_pickup_minutes ?? 0} /></label>
        <label className="field">Hold ready food after the window (minutes)<input type="number" name="holding" min="5" max="240" placeholder="No automatic cutoff" defaultValue={store.holding_minutes ?? ""} /></label>
      </div>
      <p>When a holding time is set, new orders become uncollected after that deadline. Refund decisions remain available to support.</p>
    </StaffForm>
  </section>;
}

export async function WorkspaceOnboarding({client,shop,store}:{client:Client;shop:string;store:Storefront|null}) {
  const [application,menu] = await Promise.all([client.rpc("vendor_application_summary",{target_shop:shop}),
    store ? client.from("commerce_menu").select("id",{head:true,count:"exact"}).eq("stall_slug",store.slug).eq("archived",false).eq("sold_out",false) : null]);
  if (application.error || menu?.error) return <Notice>Could not load shop readiness.</Notice>;
  const app = application.data;
  const payment = {not_started:"Not started",pending:"In progress",verified:"Verified",legacy_enabled:"Existing checkout enabled"};
  return <section className="panel panel-pad stack ops-form"><h2>Shop readiness</h2>
    <dl className="vendor-facts">
      <dt>Application</dt><dd>{app ? applicationStatuses[app.status] : "No linked application"}</dd>
      {app && <><dt>Documents on file</dt><dd>{app.document_count}</dd><dt>Agreement</dt><dd>{app.agreed_at ? (app.agreement_version ?? "Accepted")+" · "+dateLabel(Date.parse(app.agreed_at)) : "Awaiting acceptance"}</dd></>}
      <dt>Platform standing</dt><dd>{store ? applicationStatuses[store.standing] : "Awaiting storefront setup"}</dd>
      <dt>Payment onboarding</dt><dd>{payment[store?.payment_status ?? "not_started"]}</dd>
      <dt>Published storefront</dt><dd>{store?.published ? <Link className="text-link" href={"/stalls/"+store.slug}>Open storefront</Link> : "Unpublished"}</dd>
      <dt>Available menu items</dt><dd>{menu?.count ?? 0}</dd><dt>Regular hours (IST)</dt><dd>{store?.opens && store.closes ? store.opens.slice(0,5)+" – "+store.closes.slice(0,5) : "Awaiting hours"}</dd>
      <dt>New paid orders</dt><dd>{store?.vendor_paused ? "Paused by vendor" : store?.enabled ? "Enabled during open hours" : "Disabled"}</dd>
    </dl><Link className="text-link" href="/vendor/onboarding">Open applicant portal</Link>
  </section>;
}

export async function VendorEarnings({client,shop,period,page}:{client:Client;shop:string;period?:string;page?:string}) {
  const days = period==="30" ? 30 : period==="1" ? 1 : 7;
  const number = page && /^[1-9]\d{0,5}$/.test(page) ? Number(page) : 1;
  const now = Date.now(), day = 86400000, offset = 19800000;
  const midnight = Math.floor((now+offset)/day)*day-offset;
  const since = new Date(midnight-(days-1)*day).toISOString(), until = new Date(midnight+day).toISOString();
  const [summary,sales] = await Promise.all([
    client.rpc("vendor_earnings",{target_shop:shop,since_time:since,until_time:until}),
    client.from("vendor_sales").select("id,reference,recorded_at,amount_paise").eq("shop_id",shop).gte("recorded_at",since).lt("recorded_at",until)
      .order("recorded_at",{ascending:false}).order("id").range((number-1)*25,number*25),
  ]);
  const href = "/vendor/earnings?shop="+shop+"&period=";
  if (summary.error || !summary.data || sales.error) return <Notice>Earnings could not be loaded.</Notice>;
  const {captured,orders,refunded,refund_pending} = summary.data;
  return <div className="stack"><nav className="chips" aria-label="Earnings period">{[1,7,30].map(d=>
    <Link key={d} className={"button compact"+(d===days?"":" secondary")} aria-current={d===days?"page":undefined} href={href+d}>{d===1?"Today":"Last "+d+" days"}</Link>)}</nav>
    <section className="panel panel-pad stack"><h2>Payments for orders placed in this period</h2>
      <div className="vendor-metrics">{[["Captured",money(captured)],["Paid orders",orders],["Refunded",money(refunded)],["Pending refunds",money(refund_pending)],["After completed refunds",money(captured-refunded)]].map(([label,value])=>
        <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="fineprint">Figures use campus dates and reflect customer payments before fees or bank settlements.</p></section>
    <section className="panel panel-pad stack"><h2>Collections in this period</h2>{sales.data.length ? sales.data.slice(0,25).map(sale=>
      <div key={sale.id} className="staff-data-row">{orderUuid.test(sale.reference) ? <Link className="text-link" href={"/vendor/orders/"+sale.reference+"?shop="+shop}>CB-{sale.reference.slice(0,8).toUpperCase()}</Link> : <strong>{sale.reference}</strong>}
        <time>{dateLabel(Date.parse(sale.recorded_at))} · {clockTime(Date.parse(sale.recorded_at))} IST</time><strong>{money(sale.amount_paise)}</strong></div>) : <p>No collections recorded.</p>}
      {(number>1 || sales.data.length>25) && <nav className="row" aria-label="Collections pages">{number>1 && <Link href={href+days+"&page="+(number-1)}>Previous</Link>}
        <span>Page {number}</span>{sales.data.length>25 && <Link href={href+days+"&page="+(number+1)}>Next</Link>}</nav>}</section></div>;
}
