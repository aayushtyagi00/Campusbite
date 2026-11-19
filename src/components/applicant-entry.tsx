"use client";

import { useState } from "react";
import Link from "next/link";
import { applicantCode } from "@/lib/onboarding-actions";
import { Notice } from "./ui";

export function ApplicantEntry({ disabled, email }: { disabled: boolean; email?: string }) {
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [switching, setSwitching] = useState(false);
  if (email && !switching) return <div className="stack"><p>Contact email · {email}</p>
    <Link className="button" href="/vendor/onboarding">Open my applications</Link>
    <button type="button" className="text-link" onClick={() => setSwitching(true)}>Use a different contact email</button></div>;
  return <form className="stack" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await applicantCode(sent, form);
      setMessage(result.message);
      if (!result.error) setSent(true);
    } finally { setBusy(false); }
  }}>
    <p>Verify your email to start a draft or return to an existing application.</p>
    <label className="field">Shop name (optional)<input name="shop_name" maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
    <label className="field">Contact email<input type="email" name="email" autoComplete="email" required readOnly={sent}
      value={address} onChange={e => setAddress(e.target.value)} /></label>
    {sent && <label className="field">Email code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required /></label>}
    {message && <Notice>{message}</Notice>}
    <button className="button" disabled={disabled || busy}>{sent ? "Verify and continue" : "Email me a code"}</button>
    {sent && <button type="button" className="text-link" onClick={() => { setSent(false); setMessage(""); }}>Change email or request another code</button>}
  </form>;
}
