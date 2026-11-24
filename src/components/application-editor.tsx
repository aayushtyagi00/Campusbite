"use client";

import { useState } from "react";
import type { FoodCourt } from "@/lib/campus";
import { saveApplication } from "@/lib/onboarding-actions";
import type { VendorApplication } from "@/lib/staff/database";
import { Notice } from "./ui";

export function ApplicationEditor({ application: a, id, initialName, courts }: { courts:readonly FoodCourt[]; application?: VendorApplication; id: string; initialName: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <form className="panel panel-pad stack" onSubmit={async event => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await saveApplication(id, a?.revision ?? -1, submitter?.value === "submit", data);
      setMessage(result.message);
    } finally { setBusy(false); }
  }}>
    <h2>Business details</h2>
    <div className="form-grid">
      <label className="field">Shop name<input name="shop_name" defaultValue={a?.shop_name ?? initialName} minLength={2} maxLength={100} required /></label>
      <label className="field">Owner or contact name<input name="contact_name" defaultValue={a?.contact_name} maxLength={100} /></label>
      <label className="field">Phone number<input name="phone" type="tel" defaultValue={a?.phone} maxLength={24} /></label>
      <label className="field">Food court<select name="court" defaultValue={a?.court ?? ""}><option value="">Select a food court</option>
        {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field">Exact stall location<input name="location" defaultValue={a?.location} maxLength={150} /></label>
      <label className="field">Cuisine<input name="cuisine" defaultValue={a?.cuisine} maxLength={120} /></label>
      <label className="field">Opens (IST)<input type="time" name="opens" defaultValue={a?.opens?.slice(0, 5)} /></label>
      <label className="field">Closes (IST)<input type="time" name="closes" defaultValue={a?.closes?.slice(0, 5)} /></label>
    </div>
    <label className="field">Business description<textarea name="description" defaultValue={a?.description} maxLength={1200} /></label>
    <label className="field">Food registration number or explanation of applicability<input name="registration" defaultValue={a?.registration} maxLength={240} /></label>
    {!a && <p>Save a draft to attach registration and supporting documents.</p>}
    <h2>Vendor agreement</h2>
    <p>I am authorized to represent this stall. I will keep its menu, availability and pickup information accurate, fulfill accepted orders and contact CampusBite if the stall cannot fulfill one.</p>
    <label className="row"><input type="checkbox" name="agreement" /> I accept the pilot vendor agreement (v1).</label>
    {message && <Notice>{message}</Notice>}
    <div className="row wrap-row">
      <button className="button secondary" value="draft" disabled={busy}>Save draft</button>
      <button className="button" value="submit" disabled={busy}>{a?.status === "changes_requested" ? "Resubmit application" : "Submit for review"}</button>
    </div>
  </form>;
}
