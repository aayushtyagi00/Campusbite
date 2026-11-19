import Link from "next/link";
import { NavigationHint } from "./navigation-hint";
import { ArrowRight } from "lucide-react";
import { applicationStatuses, type VendorApplication } from "@/lib/staff/database";
import { Empty, Status } from "./ui";

export function AdminOverview({ shops, applications }: { shops: number; applications: number }) {
  return <>
    <div className="ops-heading"><div><h1>CampusBite Admin</h1><p>Review vendor applications and control access to campus shops.</p></div>
      <Link className="button" href="/admin/access">Manage vendor access<NavigationHint /></Link></div>
    <div className="metrics">
      <Link className="panel panel-pad metric" href="/admin/vendors"><p>Vendor shops</p><strong>{shops}</strong><ArrowRight className="metric-arrow" size={17} /><NavigationHint /></Link>
      <Link className="panel panel-pad metric" href="/admin/applications"><p>Applications awaiting review</p><strong>{applications}</strong><ArrowRight className="metric-arrow" size={17} /><NavigationHint /></Link>
    </div>
  </>;
}

export function VendorApplications({ applications }: { applications: VendorApplication[] }) {
  return <>
    <div className="ops-heading"><div><h1>Vendor applications</h1><p>Review shop details before granting access.</p></div>
      <Link className="button secondary" href="/admin/access">Access Management<NavigationHint /></Link></div>
    <div className="stack">
      {!applications.length && <Empty title="No applications yet" />}
      {applications.map(item => <article className="panel panel-pad stack" key={item.id}>
        <div className="row between wrap-row"><h2>{item.shop_name}</h2><Status tone={item.status === "submitted" ? "warn" : "good"}>{applicationStatuses[item.status]}</Status></div>
        <dl className="application-details">
          <div><dt>Contact name</dt><dd>{item.contact_name}</dd></div>
          <div><dt>Email</dt><dd>{item.email}</dd></div>
          <div><dt>Phone</dt><dd>{item.phone}</dd></div>
          <div><dt>Location</dt><dd>{item.location}</dd></div>
        </dl>
        {item.description && <p className="application-description">{item.description}</p>}
        <Link className="text-link" href={"/admin/applications/"+item.id}>Open application</Link>
      </article>)}
    </div>
  </>;
}
