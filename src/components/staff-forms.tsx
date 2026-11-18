"use client";

import { useActionState, useState, type ReactNode } from "react";
import { requestStaffPasswordCode, saveStaffPassword, signInWithStaffPassword, startStaffGoogle, submitVendorApplication } from "@/lib/staff/actions";
import type { StaffArea } from "@/lib/staff/database";
import { Notice } from "./ui";

type State = { message: string; error?: boolean };
type Action = (state: State, data: FormData) => Promise<State>;
const initial: State = { message: "" };

export function StaffForm({ action, label, children, secondary = false, disabled = false }: {
  action: Action; label: string; children?: ReactNode; secondary?: boolean; disabled?: boolean;
}) {
  const [status, submit, pending] = useActionState(action, initial);
  return <form action={submit} className="stack">
    {children}
    {status.message && (status.error ? <Notice>{status.message}</Notice> : <p role="status">{status.message}</p>)}
    <button className={`button${secondary ? " secondary" : ""}`} disabled={disabled || pending}>{pending ? "Please wait…" : label}</button>
  </form>;
}

export function StaffSignInForm({ area, disabled, googleDisabled }: { area: StaffArea; disabled: boolean; googleDisabled: boolean }) {
  return <div className="stack">
    <StaffForm action={startStaffGoogle.bind(null, area)} label="Continue with Google" secondary disabled={googleDisabled} />
    <div className="staff-login-divider"><span>or sign in with email</span></div>
    <StaffForm action={signInWithStaffPassword.bind(null, area)} label="Sign in" disabled={disabled}>
      <label className="field">Email address<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label className="field">Password<input name="password" type="password" autoComplete="current-password" required maxLength={512} /></label>
    </StaffForm>
    <details className="staff-password-setup">
      <summary className="text-link">Set or reset your password</summary>
      <StaffPasswordSetup area={area} disabled={disabled} />
    </details>
  </div>;
}

function StaffPasswordSetup({ area, disabled }: { area: StaffArea; disabled: boolean }) {
  const [email, setEmail] = useState("");
  const [request, send, sending] = useActionState(requestStaffPasswordCode.bind(null, area), { message: "" });
  const [saved, save, saving] = useActionState(saveStaffPassword.bind(null, area), initial);
  const completed = Boolean(saved.message && !saved.error);
  return <div className="stack staff-password-content">
    <p className="fineprint">Use your approved email to set a password for the first time or replace a forgotten password.</p>
    <form action={send} className="stack">
      <label className="field">Approved email address
        <input name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={254} />
      </label>
      <button className="button secondary" disabled={disabled || sending}>{sending ? "Requesting…" : "Send password setup code"}</button>
      {request.message && <Notice>{request.message}</Notice>}
    </form>
    {request.email && !completed && <form action={save} className="stack">
      <input type="hidden" name="email" value={request.email} />
      <label className="field">Password setup code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} required /></label>
      <label className="field">New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
      <label className="field">Confirm new password<input name="confirm_password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
      {saved.message && <Notice>{saved.message}</Notice>}
      <button className="button" disabled={disabled || saving}>{saving ? "Saving…" : "Save password"}</button>
    </form>}
    {completed && <p role="status">{saved.message}</p>}
  </div>;
}

export function VendorApplicationForm({ disabled }: { disabled: boolean }) {
  return <StaffForm action={submitVendorApplication} label="Submit application" disabled={disabled}>
    <div className="sr-only" aria-hidden="true"><label>Company website<input name="company_website" tabIndex={-1} autoComplete="off" /></label></div>
    <div className="form-grid">
      <label className="field">Shop name<input name="shop_name" required minLength={2} maxLength={100} /></label>
      <label className="field">Contact name<input name="contact_name" autoComplete="name" required minLength={2} maxLength={100} /></label>
      <label className="field">Contact email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="field">Phone number<input name="phone" type="tel" autoComplete="tel" required maxLength={24} /></label>
    </div>
    <label className="field">Food court and stall location<input name="location" required minLength={2} maxLength={150} /></label>
    <label className="field">Tell us about your shop<textarea name="description" maxLength={1200} rows={4} /></label>
    <p className="fineprint">CampusBite administrators use these details to review your application.</p>
  </StaffForm>;
}
