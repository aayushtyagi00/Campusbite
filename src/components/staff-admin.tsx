import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createVendorShop, reviewVendorApplication, revokeVendorAccess, saveVendorAccess } from "@/lib/staff/actions";
import { vendorRoles, type VendorAccess, type VendorApplication, type VendorShop } from "@/lib/staff/database";
import { StaffForm } from "./staff-forms";
import { Empty, Status } from "./ui";

export function AdminOverview({ shops, applications }: { shops: number; applications: number }) {
  return <>
    <div className="ops-heading"><div><h1>CampusBite Admin</h1><p>Review vendor applications and control access to campus shops.</p></div></div>
    <div className="metrics">
      <Link className="panel panel-pad metric" href="/admin/access"><p>Vendor shops</p><strong>{shops}</strong><ArrowRight className="metric-arrow" size={17} /></Link>
      <Link className="panel panel-pad metric" href="/admin/applications"><p>Applications awaiting review</p><strong>{applications}</strong><ArrowRight className="metric-arrow" size={17} /></Link>
    </div>
  </>;
}

export function AccessManagement({ shops, grants }: { shops: VendorShop[]; grants: VendorAccess[] }) {
  return <>
    <div className="ops-heading"><div><h1>Access Management</h1><p>Grant an email access to one shop at a time. Select the shop and assign the role.</p></div></div>
    <div className="access-grid">
      <section className="panel panel-pad stack">
        <h2>Add a vendor shop</h2>
        <StaffForm action={createVendorShop} label="Create shop">
          <label className="field">Vendor shop name<input name="name" minLength={2} maxLength={100} required /></label>
        </StaffForm>
      </section>
      <section className="panel panel-pad stack">
        <h2>Assign shop access</h2>
        {shops.length ? <StaffForm action={saveVendorAccess} label="Save access">
          <div className="form-grid">
            <label className="field">Vendor shop<select name="shop_id" defaultValue="" required>
              <option value="" disabled>Select a shop</option>
              {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
            </select></label>
            <label className="field">Approved email<input name="email" type="email" placeholder="name@example.com" maxLength={254} required /></label>
            <label className="field">Role<select name="role" defaultValue="staff">
              {Object.entries(vendorRoles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
          </div>
          <p className="fineprint">Owner and Manager can see orders and sales. Staff can see orders. To change a role, save a new role for the same shop and email.</p>
        </StaffForm> : <p>Create a vendor shop to assign its first email.</p>}
      </section>
    </div>
    <section className="stack staff-records" aria-label="Shop access list">
      <h2>Access by shop</h2>
      {!shops.length && <Empty title="No vendor shops yet" />}
      {shops.map(shop => {
        const assigned = grants.filter(grant => grant.shop_id === shop.id);
        return <article className="panel panel-pad stack" key={shop.id}>
          <h3>{shop.name}</h3>
          {assigned.length ? <ul className="stack">{assigned.map(grant => <li className="access-row" key={grant.email}>
            <span>{grant.email}</span><Status tone="good">{vendorRoles[grant.role]}</Status>
            <StaffForm action={revokeVendorAccess} label="Revoke access" secondary>
              <input type="hidden" name="shop_id" value={shop.id} /><input type="hidden" name="email" value={grant.email} />
            </StaffForm>
          </li>)}</ul> : <p>No emails have access to this shop.</p>}
        </article>;
      })}
    </section>
  </>;
}

export function VendorApplications({ applications }: { applications: VendorApplication[] }) {
  return <>
    <div className="ops-heading"><div><h1>Vendor applications</h1><p>Review shop details before granting access.</p></div>
      <Link className="button secondary" href="/admin/access">Access Management</Link></div>
    <div className="stack">
      {!applications.length && <Empty title="No applications yet" />}
      {applications.map(item => <article className="panel panel-pad stack" key={item.id}>
        <div className="row between wrap-row"><h2>{item.shop_name}</h2><Status tone={item.status === "submitted" ? "warn" : "good"}>{item.status === "submitted" ? "Submitted" : "Reviewed"}</Status></div>
        <dl className="application-details">
          <div><dt>Contact name</dt><dd>{item.contact_name}</dd></div>
          <div><dt>Email</dt><dd>{item.email}</dd></div>
          <div><dt>Phone</dt><dd>{item.phone}</dd></div>
          <div><dt>Location</dt><dd>{item.location}</dd></div>
        </dl>
        {item.description && <p className="application-description">{item.description}</p>}
        {item.status === "submitted" && <StaffForm action={reviewVendorApplication} label="Mark reviewed" secondary>
          <input type="hidden" name="id" value={item.id} />
        </StaffForm>}
      </article>)}
    </div>
  </>;
}
