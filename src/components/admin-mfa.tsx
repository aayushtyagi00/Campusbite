"use client";
import { useState } from "react";
import { beginAdminMfa, verifyAdminMfa } from "@/lib/admin-mfa";
import { staffSignOut } from "@/lib/staff/actions";

export function AdminMfa() {
  const [state,setState]=useState<Awaited<ReturnType<typeof beginAdminMfa>>>({message:""});
  const [busy,setBusy]=useState(false);
  return <section className="panel panel-pad stack"><h1>Administrator verification</h1>
    {state.message && <p role="status">{state.message}</p>}
    {state.secret && <code>{state.secret}</code>}
    <form className="stack" action={async form=>{
      setBusy(true);
      try {
        if (state.factor) {
          const message=await verifyAdminMfa(state.factor,String(form.get("code")));
          setState({...state,message});
        } else setState(await beginAdminMfa());
      } finally {setBusy(false);}
    }}>
      {state.factor && <label className="field">Authenticator code<input name="code" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} inputMode="numeric" required /></label>}
      <button className="button" disabled={busy}>{state.factor ? "Verify code" : "Use authenticator app"}</button>
    </form>
    <form action={staffSignOut.bind(null, "admin")}><button className="button secondary">Sign out</button></form>
  </section>;
}
