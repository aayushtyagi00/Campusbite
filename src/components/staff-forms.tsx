"use client";

import { useActionState, useState, type ReactNode } from "react";
import { requestStaffPasswordCode, saveStaffPassword, signInWithStaffPassword, startStaffGoogle } from "@/lib/staff/actions";
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
  const google = <StaffForm action={startStaffGoogle.bind(null, area)} label="Continue with Google" secondary={area === "vendor"} disabled={googleDisabled} />;
  if (area === "admin") return google;
  return <div className="stack">
    {google}
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
