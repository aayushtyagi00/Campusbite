import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { foodCourts, categories } from "@/lib/campus";
import { orderUuid } from "@/lib/commerce";
import type { adminSession } from "@/lib/staff/access";
import { applicationStatuses, type VendorApplication, type Storefront, type VendorShop } from "@/lib/staff/database";
import { saveStorefront, addOnboardingItem, reviewApplication } from "@/lib/onboarding-actions";
import { ApplicationDetails, ApplicationDocuments } from "./vendor-onboarding";
import { Back, Empty, Notice, Status } from "./ui";
import { StaffForm } from "./staff-forms";

type Client = NonNullable<Awaited<ReturnType<typeof adminSession>>>["client"];
const payments = { not_started: "Not started", pending: "In progress", verified: "Verified", legacy_enabled: "Existing checkout · verification unrecorded" };
const label = (s?: Pick<Storefront, "standing" | "published" | "enabled" | "vendor_paused">) => s?.standing === "suspended" ? "Suspended" :
  s?.enabled && s.vendor_paused ? "Paused by vendor" : s?.enabled ? "Accepting orders" : s?.published ? "Published · browse only" : "Unpublished";

export async function CurrentVendors({ client, page }: { client: Client; page: number }) {
  const start = (page - 1) * 25;
  const shops = await client.from("vendor_shops").select("*").order("name").order("id").range(start, start + 25);
  if (shops.error) return <Notice>Current vendors could not be loaded.</Notice>;
  const visible = shops.data.slice(0, 25);
  const listings = visible.length ? await client.from("commerce_stalls").select("shop_id,standing,enabled,published,location,vendor_paused")
    .in("shop_id", visible.map(s => s.id)) : null;
  return <><div className="ops-heading"><div><h1>Current Vendors</h1><p>Participating shops, storefronts and ordering status.</p></div>
    <Link href="/admin/applications" className="button secondary">Review applications</Link></div>
    {listings?.error ? <Notice>Storefronts could not be loaded.</Notice> : <div className="stack">
      {visible.map(s => {
        const row = listings?.data?.find(r => r.shop_id === s.id);
        return <Link className="panel panel-pad row between wrap-row" key={s.id} href={"/admin/vendors/" + s.id}>
          <div><h2>{s.name}</h2>{row?.location && <p>{row.location}</p>}</div><Status>{label(row)}</Status></Link>;
      })}
      {!visible.length && <Empty title="No shops on this page" />}
      <nav className="row">{page > 1 && <Link href={"/admin/vendors?page=" + (page - 1)}>Previous</Link>}
        {shops.data.length > 25 && <Link href={"/admin/vendors?page=" + (page + 1)}>Next</Link>}</nav>
    </div>}</>;
}

function ProfileForm({ shop, listing: s, application: a, unlinked }: { shop: VendorShop; listing: Storefront | null; application: VendorApplication | null; unlinked: string[] }) {
  const suggested = shop.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "stall-" + shop.id.slice(0, 8);
  return <section className="panel panel-pad stack"><h2>Storefront and payments</h2>
    <StaffForm action={saveStorefront.bind(null, shop.id, s?.revision ?? -1)} label="Save storefront">
      <div className="form-grid">
        <label className="field">Storefront URL slug<input name="slug" list="unlinked-slugs" defaultValue={s?.slug ?? suggested} readOnly={!!s}
          required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} /></label>
        <datalist id="unlinked-slugs">{unlinked.map(slug => <option key={slug} value={slug} />)}</datalist>
        <label className="field">Public stall name<input name="display_name" defaultValue={s?.display_name || a?.shop_name || shop.name} required maxLength={100} /></label>
        <label className="field">Food court<select name="court" defaultValue={s?.court || a?.court || ""} required><option value="">Choose a court</option>
          {foodCourts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field">Exact location<input name="location" defaultValue={s?.location || a?.location} required maxLength={150} /></label>
        <label className="field">Cuisine<input name="cuisine" defaultValue={s?.cuisine || a?.cuisine} required maxLength={120} /></label>
        <label className="field">Orders per pickup window<input type="number" name="capacity" defaultValue={s?.capacity ?? 5} min={1} max={100} required /></label>
        <label className="field">Opens (IST)<input type="time" name="opens" defaultValue={(s?.opens || a?.opens)?.slice(0, 5)} required /></label>
        <label className="field">Closes (IST)<input type="time" name="closes" defaultValue={(s?.closes || a?.closes)?.slice(0, 5)} required /></label>
        <label className="field">Payment onboarding<select name="payment_status" defaultValue={s?.payment_status ?? "not_started"}>
          {Object.entries(payments).filter(([key]) => key !== "legacy_enabled" || s?.payment_status === key).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label className="field">Provider account reference<input name="provider_ref" defaultValue={s?.provider_ref} maxLength={150} /></label>
        <label className="field">Shop standing<select name="standing" defaultValue={s?.standing ?? "approved"}><option value="approved">Approved</option><option value="suspended">Suspended</option></select></label>
      </div>
      {!s && unlinked.length > 0 && <p>To keep an existing pilot menu, use its unlinked URL slug: {unlinked.join(", ")}.</p>}
      <p>Mark payments verified after confirming the account with the provider. Suspension hides the listing and closes new checkout.</p>
      <label className="row"><input type="checkbox" name="published" defaultChecked={s?.published} /> Publish in the student directory</label>
      <label className="row"><input type="checkbox" name="enabled" defaultChecked={s?.enabled} /> Accept paid orders</label>
    </StaffForm></section>;
}

export async function VendorRecord({ client, id }: { client: Client; id: string }) {
  if (!orderUuid.test(id)) notFound();
  const [shop, listing, app, team, available] = await Promise.all([
    client.from("vendor_shops").select("*").eq("id", id).maybeSingle(),
    client.from("commerce_stalls").select("*").eq("shop_id", id).maybeSingle(),
    client.from("vendor_applications").select("*").eq("shop_id", id).maybeSingle(),
    client.from("vendor_access").select("email,role").eq("shop_id", id).order("email"),
    client.from("commerce_stalls").select("slug").is("shop_id", null).order("slug"),
  ]);
  if (shop.error || listing.error || app.error || team.error || available.error) return <Notice>Shop details could not be loaded.</Notice>;
  if (!shop.data) notFound();
  const s = listing.data, a = app.data;
  const menu = s ? await client.from("commerce_menu").select("id", { count: "exact", head: true }).eq("stall_slug", s.slug) : null;
  return <div className="stack"><Back href="/admin/vendors">Current Vendors</Back>
    <div className="ops-heading"><div><h1>{shop.data.name}</h1><p>{s?.location}</p></div><Status>{label(s ?? undefined)}</Status></div>
    <section className="panel panel-pad stack"><h2>Shop readiness</h2><dl className="application-details">
      <div><dt>Application</dt><dd>{a ? <Link href={"/admin/applications/" + a.id}>{applicationStatuses[a.status]} · View record</Link> : "Manually created shop"}</dd></div>
      <div><dt>Payment onboarding</dt><dd>{payments[s?.payment_status ?? "not_started"]}</dd></div>
      <div><dt>Menu</dt><dd>{menu?.error ? "Unavailable" : (menu?.count ?? 0) + " items"}</dd></div>
      <div><dt>Regular hours (IST)</dt><dd>{s?.opens && s.closes ? s.opens.slice(0, 5) + " – " + s.closes.slice(0, 5) : "Awaiting setup"}</dd></div>
    </dl>{s?.published && s.standing === "approved" && <Link href={"/stalls/" + s.slug}>Open public storefront</Link>}</section>
    <ProfileForm key={s?.revision ?? "new"} shop={shop.data} listing={s} application={a} unlinked={available.data.map(r => r.slug)} />
    {s && <details className="panel panel-pad"><summary>Add a menu item</summary>
      <StaffForm action={addOnboardingItem.bind(null, id, randomUUID())} label="Add item">
        <label className="field">Item name<input name="name" required maxLength={100} /></label>
        <label className="field">Category<select name="category">{(s.menu_categories ?? categories).map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Description<input name="description" required maxLength={500} /></label>
        <label className="field">Dietary label<input name="diet" required maxLength={80} /></label>
        <div className="form-grid"><label className="field">Price in rupees<input name="price" type="number" min={1} max={10000} step=".01" required /></label>
          <label className="field">Preparation minutes<input name="prep" type="number" min={1} max={50} required /></label></div>
      </StaffForm></details>}
    <section className="panel panel-pad stack"><h2>Shop team</h2>{team.data.map(g => <p key={g.email}>{g.email} · {g.role}</p>)}
      <Link href={"/admin/access?shop=" + id}>Manage team access</Link></section>
  </div>;
}

export async function ApplicationReview({ client, id }: { client: Client; id: string }) {
  if (!orderUuid.test(id)) notFound();
  const result = await client.from("vendor_applications").select("*").eq("id", id).maybeSingle();
  if (result.error) return <Notice>Application unavailable.</Notice>;
  const a = result.data;
  if (!a || a.status === "draft") notFound();
  // Linking an existing shop explicitly grants the applicant owner access there.
  const shops = a.status === "under_review" ? await client.from("vendor_shops").select("id,name").order("name") : null;
  return <div className="stack"><Back href="/admin/applications">Vendor applications</Back>
    <div className="ops-heading"><h1>{a.shop_name}</h1><Status>{applicationStatuses[a.status]}</Status></div>
    <section className="panel panel-pad stack"><ApplicationDetails application={a} />{a.review_note && <Notice>{a.review_note}</Notice>}</section>
    <ApplicationDocuments application={a} />
    {a.shop_id && <Link className="button secondary" href={"/admin/vendors/" + a.shop_id}>Open shop record</Link>}
    {a.status === "submitted" && <StaffForm action={reviewApplication.bind(null, a.id, a.revision)} label="Start review"><input name="decision" type="hidden" value="under_review" /></StaffForm>}
    {a.status === "under_review" && <section className="panel panel-pad stack"><h2>Review decision</h2>
      <StaffForm action={reviewApplication.bind(null, a.id, a.revision)} label="Save decision">
        <label className="field">Decision<select name="decision" required defaultValue=""><option value="">Choose a decision</option>
          <option value="changes_requested">Request corrections</option><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
        <label className="field">Message to the applicant<textarea name="note" maxLength={1000} /></label>
        <label className="field">Shop to grant on approval<select name="existing_shop"><option value="">Create a new shop</option>
          {shops?.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <p>Approval grants {a.email} owner access to the selected shop. Give a reason when requesting corrections or rejecting an application.</p>
      </StaffForm></section>}
  </div>;
}
