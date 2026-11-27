"use client";
import { PushControl } from "./push-control";
import { Challenge } from "./challenge";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { saveStudentProfile, studentAuth } from "@/lib/student-auth-actions";
import type { StudentProfile } from "@/lib/student-profile";
import { Back, Notice } from "./ui";

type Operation = Parameters<typeof studentAuth>[0];

export function LiveStudentAccount({ section, email, profile, returnTo, googleError, deviceLogout, siteKey }: {
  section: string; email?: string; profile?: StudentProfile; returnTo?: string; googleError?: boolean; deviceLogout?: boolean; siteKey?: string;
}) {
  const [step, setStep] = useState<Operation>("sign-in");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState(deviceLogout ? "Signed out on this device. The provider could not confirm session revocation."
    : googleError ? "Google sign-in could not be completed." : "");
  const [pending, setPending] = useState(false);
  const [challengeVersion, setChallengeVersion] = useState(0);
  async function run(operation: Operation, form = new FormData()) {
    setPending(true);
    setMessage("");
    if (returnTo) form.set("returnTo", returnTo);
    try {
      const result = await studentAuth(operation, form);
      if (result.error) setMessage(result.error);
      if (result.next) {
        setStep(result.next);
        setMessage("Check your email for a verification code.");
      }
    } finally {
      setPending(false);
      if (operation === "sign-up") setChallengeVersion(version => version + 1);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(step, new FormData(event.currentTarget));
  }
  if (section === "account") return <div className="narrow">
    {email && <PushControl audience="student" />}
    <h1>Your account</h1>
    <section className="panel panel-pad stack">
      {email ? <><p>{email}</p>{profile && <form className="stack" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        try { const result = await saveStudentProfile(form); setMessage(result.error ?? "Account settings saved."); }
        catch { setMessage("Could not save account settings. Please try again."); }
        finally { setPending(false); }
      }}>
        <label className="field">Display name<input name="name" autoComplete="name" defaultValue={profile.name} maxLength={80} required /></label>
        <fieldset className="stack"><legend>Notification preferences</legend><p>Show alerts while My Orders is open.</p>
          <label><input name="orderAlerts" type="checkbox" defaultChecked={profile.orderAlerts} /> Order and pickup updates</label>
          <label><input name="refundAlerts" type="checkbox" defaultChecked={profile.refundAlerts} /> Refund updates</label>
        </fieldset>
        <button className="button" disabled={pending}>Save account settings</button>
      </form>}<button className="button secondary" disabled={pending} onClick={() => void run("sign-out")}>Sign out</button></>
        : <Link className="button" href="/sign-in">Sign in or register</Link>}
      {message && <Notice>{message}</Notice>}
      <Link href="/orders">My Orders</Link><Link href="/about">About CampusBite</Link>
    </section>
  </div>;
  const inputCode = step === "confirm";
  const password = step === "sign-in" || step === "sign-up";
  const titles = { "sign-in": "Sign in to CampusBite", "sign-up": "Create your account", confirm: "Confirm your email" } as const;
  if (!(step in titles)) return null;
  return <div className="narrow auth">
    <Back href="/">Home</Back><h1>{titles[step as keyof typeof titles]}</h1>
    <section className="panel panel-pad stack">
      {section === "sign-in" && <button className="button secondary" disabled={pending} onClick={() => void run("google")}>Continue with Google</button>}
      <form className="stack" onSubmit={submit}>
        {step === "sign-up" && <label className="field">Display name<input name="name" autoComplete="name" maxLength={80} required /></label>}
        <label className="field">Email<input type="email" name="email" autoComplete="email" required value={address} readOnly={inputCode} onChange={event => setAddress(event.target.value)} /></label>
        {inputCode && <label className="field">Verification code<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" required /></label>}
        {password && <label className="field">Password<input type="password" name="password" minLength={8} maxLength={72} autoComplete={step === "sign-in" ? "current-password" : "new-password"} required /></label>}
        {step === "sign-up" && <label className="field">Confirm password<input name="confirmation" autoComplete="new-password" type="password" minLength={8} maxLength={72} required /></label>}
        {step === "sign-up" && <p className="fineprint">Read the <Link href="/privacy-policy">Privacy Policy</Link> and <Link href="/terms-of-service">Terms of Service</Link> before creating your account.</p>}
        {step === "sign-up" && siteKey && <Challenge key={challengeVersion} siteKey={siteKey} action="student-signup" />}
        <button className="button" disabled={pending}>{pending ? "Please wait…" : inputCode ? "Verify code" : step === "sign-up" ? "Create account" : "Sign in"}</button>
      </form>
      {message && <Notice>{message}</Notice>}
      {section === "sign-in" ? <div className="row between"><Link href="/recovery">Forgot password?</Link>
        <button className="text-link" disabled={pending} onClick={() => { setMessage(""); setStep(step === "sign-in" ? "sign-up" : "sign-in"); }}>{step === "sign-in" ? "Create account" : "Back to sign in"}</button></div>
        : <Link href="/sign-in">Back to sign in</Link>}
    </section>
  </div>;
}
