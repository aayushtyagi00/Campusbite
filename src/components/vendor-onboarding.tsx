import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { applicantSession } from "@/lib/vendor-applicant";
import { orderUuid } from "@/lib/commerce";
import { applicationStatuses, type VendorApplication } from "@/lib/staff/database";
import { foodCourts } from "@/lib/campus";
import { changeDocument } from "@/lib/onboarding-actions";
import { ApplicationEditor } from "./application-editor";
import { StaffForm } from "./staff-forms";
import { Back, Empty, Notice, Status } from "./ui";

export function ApplicationDetails({ application: a }: { application: VendorApplication }) {
  const details = [
    ["Contact", a.contact_name], ["Contact email", a.email], ["Phone", a.phone],
    ["Food court", foodCourts.find(c => c.id === a.court)?.name], ["Stall location", a.location], ["Cuisine", a.cuisine],
    ["Hours (IST)", a.opens && a.closes && a.opens.slice(0, 5) + " – " + a.closes.slice(0, 5)],
    ["Business description", a.description], ["Food registration", a.registration],
    ["Vendor agreement", a.agreed_at && a.agreement_version + " · " + new Date(a.agreed_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })],
    ["Verified contact", a.verified_at ? "Email verified" : "Awaiting verification"],
  ];
  return <dl className="application-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not supplied"}</dd></div>)}</dl>;
}

export function ApplicationDocuments({ application: a, editable = false }: { application: VendorApplication; editable?: boolean }) {
  return <section className="panel panel-pad stack"><h2>Supporting documents</h2>
    {!a.documents.length && <p>No documents attached.</p>}
    {a.documents.map(doc => <div key={doc.path} className="row between wrap-row">
      <a className="text-link" href={"/api/vendor-documents/" + doc.path} download>{doc.name}</a>
      {editable && <StaffForm action={changeDocument.bind(null, a.id, a.revision, doc.path)} label="Remove" secondary />}
    </div>)}
    {editable && a.documents.length < 4 && <StaffForm action={changeDocument.bind(null, a.id, a.revision, null)} label="Upload document" secondary>
      <label className="field">Registration or supporting PDF (up to 3 MB)<input type="file" name="document" accept="application/pdf" required /></label>
    </StaffForm>}
  </section>;
}

export async function VendorOnboarding({ id, name = "" }: { id?: string; name?: string }) {
  const session = await applicantSession();
  if (!session) redirect("/vendor#vendor-application");
  if (id && id !== "new" && !orderUuid.test(id)) notFound();
  const newHref = "/vendor/onboarding/new" + (name ? "?name=" + encodeURIComponent(name.slice(0, 100)) : "");
  const base = session.db.from("vendor_applications");
  if (!id) {
    const result = await base.select("id,shop_name,status").eq("email", session.email).or(session.ownership).order("created_at", { ascending: false });
    return <main className="wrap staff-entry-main stack" id="main"><Back href="/vendor">Vendor portal</Back>
      <div className="ops-heading"><div><h1>My applications</h1><p>{session.email}</p></div><Link className="button" href={newHref}>New application</Link></div>
      {result.error ? <Notice>Applications could not be loaded.</Notice> : result.data.length ? result.data.map(a =>
        <Link className="panel panel-pad row between" key={a.id} href={"/vendor/onboarding/" + a.id}><strong>{a.shop_name}</strong><Status>{applicationStatuses[a.status]}</Status></Link>)
        : <Empty title="No applications yet"><p>Start a draft with your stall’s name.</p></Empty>}
    </main>;
  }
  const result = id === "new" ? null : await base.select("*").eq("email", session.email).or(session.ownership).eq("id", id).maybeSingle();
  if (result?.error) return <Notice>Application details could not be loaded.</Notice>;
  if (result && !result.data) notFound();
  const a = result?.data ?? undefined;
  const listing = a?.shop_id ? await session.db.from("commerce_stalls").select("payment_status,published,enabled")
    .eq("shop_id", a.shop_id).maybeSingle() : null;
  const editable = !a || ["draft", "changes_requested"].includes(a.status);
  return <main className="wrap staff-entry-main stack" id="main"><Back href="/vendor/onboarding">My applications</Back>
    <div className="ops-heading"><div><h1>{a?.shop_name ?? "New application"}</h1><p>{session.email}</p></div>
      {a && <Status>{applicationStatuses[a.status]}</Status>}</div>
    {a?.review_note && <Notice>{a.review_note}</Notice>}
    {editable ? <ApplicationEditor id={a?.id ?? randomUUID()} application={a} initialName={name.slice(0, 100)} /> :
      a && <section className="panel panel-pad stack"><h2>Application details</h2><ApplicationDetails application={a} />
        {a.shop_id && <p>Payment onboarding · {listing?.error ? "Unavailable" : ({
          verified: "Verified", pending: "In progress", not_started: "Not started", legacy_enabled: "Existing checkout"
        }[listing?.data?.payment_status ?? "not_started"])}. Storefront · {listing?.data?.published ? "Published" : "Unpublished"}.</p>}
        {a.status === "approved" && <Link href="/vendor/sign-in">Sign in to the shop workspace</Link>}</section>}
    {a && <ApplicationDocuments application={a} editable={editable} />}
  </main>;
}
