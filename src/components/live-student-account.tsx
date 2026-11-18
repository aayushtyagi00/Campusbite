"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { studentAuth } from "@/lib/student-auth-actions";
import { Back, Notice } from "./ui";

type Operation = Parameters<typeof studentAuth>[0];

export function LiveStudentAccount({ section, email, returnTo, googleError }: {
  section: string; email?: string; returnTo?: string; googleError?: boolean;
}) {
  const [step, setStep] = useState<Operation>(section === "recovery" ? "send-reset" : "sign-in");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState(googleError ? "Google sign-in could not be completed." : "");
  const [pending, setPending] = useState(false);
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
    } finally { setPending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(step, new FormData(event.currentTarget));
  }
  if (section === "account") return <div className="narrow">
    <h1>Your account</h1>
    <section className="panel panel-pad stack">
      {email ? <><p>{email}</p><button className="button secondary" disabled={pending} onClick={() => void run("sign-out")}>Sign out</button></>
        : <Link className="button" href="/sign-in">Sign in or register</Link>}
      {message && <Notice>{message}</Notice>}
      <Link href="/orders">My Orders</Link><Link href="/about">About CampusBite</Link>
    </section>
  </div>;
  const inputCode = step === "confirm" || step === "reset";
  const password = step === "sign-in" || step === "sign-up" || step === "reset";
  const titles = { "sign-in": "Sign in to CampusBite", "sign-up": "Create your account", confirm: "Confirm your email",
    "send-reset": "Reset your password", reset: "Set a new password" } as const;
  if (!(step in titles)) return null;
  return <div className="narrow auth">
    <Back href="/">Home</Back><h1>{titles[step as keyof typeof titles]}</h1>
    <section className="panel panel-pad stack">
      {section === "sign-in" && <button className="button secondary" disabled={pending} onClick={() => void run("google")}>Continue with Google</button>}
      <form className="stack" onSubmit={submit}>
        <label className="field">Email<input type="email" name="email" autoComplete="email" required value={address} readOnly={inputCode} onChange={event => setAddress(event.target.value)} /></label>
        {inputCode && <label className="field">Verification code<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" required /></label>}
        {password && <label className="field">Password<input type="password" name="password" minLength={8} maxLength={72} autoComplete={step === "sign-in" ? "current-password" : "new-password"} required /></label>}
        <button className="button" disabled={pending}>{pending ? "Please wait…" : step === "send-reset" ? "Email a code" : inputCode ? "Verify code" : step === "sign-up" ? "Create account" : "Sign in"}</button>
      </form>
      {message && <Notice>{message}</Notice>}
      {section === "sign-in" ? <div className="row between"><Link href="/recovery">Forgot password?</Link>
        <button className="text-link" disabled={pending} onClick={() => { setMessage(""); setStep(step === "sign-in" ? "sign-up" : "sign-in"); }}>{step === "sign-in" ? "Create account" : "Back to sign in"}</button></div>
        : <Link href="/sign-in">Back to sign in</Link>}
    </section>
  </div>;
}
