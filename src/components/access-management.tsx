"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVendorShop, saveVendorAccess } from "@/lib/staff/actions";
import { vendorRoles, type VendorAccess, type VendorShop } from "@/lib/staff/database";
import { ShopMembers } from "./shop-members";
import { StaffForm } from "./staff-forms";

export function AccessManagement({ shops, selected, page, grants, shopPages }: {
  shops: VendorShop[]; selected?: VendorShop; page: number; grants: VendorAccess[]; shopPages: React.ReactNode;
}) {
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  return <fieldset disabled={switching} className="access-controls" aria-busy={switching}>
    <div className="ops-heading"><div><h1>Access Management</h1><p>Grant an email access to one shop at a time. Select the shop and assign the role.</p></div></div>
    <div className="access-grid">
      <section className="panel panel-pad stack">
        <h2>Add a vendor shop</h2>
        <StaffForm action={createVendorShop} label="Create shop">
          <label className="field">Vendor shop name<input name="name" minLength={2} maxLength={100} required /></label>
        </StaffForm>
      </section>
      <section className="panel panel-pad stack">
        <h2>Select a shop</h2>
        {shops.map(shop => <div className="row between" key={shop.id}>
          <span>{shop.name}</span><button type="button" className="button compact secondary"
            disabled={selected?.id === shop.id} aria-label={`Select shop ${shop.name}`}
            onClick={() => startSwitch(() => router.push(`/admin/access?page=${page}&shop=${shop.id}`))}>
            {selected?.id === shop.id ? "Selected" : "Select shop"}
          </button>
        </div>)}
        {shopPages}
      </section>
      <section className="panel panel-pad stack">
        <h2>{selected ? `Grant access to ${selected.name}` : "Grant vendor access"}</h2>
        {selected ? <StaffForm key={selected.id} action={saveVendorAccess} label={`Grant access to ${selected.name}`}>
          <input type="hidden" name="shop_id" value={selected.id} />
          <div className="form-grid">
            <label className="field">Approved email<input name="email" type="email" placeholder="name@example.com" maxLength={254} required /></label>
            <label className="field">Role<select name="role" defaultValue="staff">
              {Object.entries(vendorRoles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
          </div>
          <p className="fineprint">Owner and Manager can see orders and sales. Staff can see orders. Use the member list below to change a role.</p>
        </StaffForm> : <p>Select a shop above, or create one to assign access.</p>}
      </section>
    </div>
    <section className="stack staff-records" aria-label="Shop access list">
      {selected && <article className="panel panel-pad stack" key={selected.id}>
          <h2>People with access to {selected.name}</h2>
          <ShopMembers shopId={selected.id} grants={grants} area="admin" />
        </article>}
    </section>
  </fieldset>;
}
