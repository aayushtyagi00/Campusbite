"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestRecovery, setRecoveredPassword, verifyStudentRecovery } from "@/lib/student-recovery-actions";
import { Back, Notice } from "./ui";

type Stage = "request" | "code" | "link" | "password" | "done";
type Saved = { email: string; attempt: string; until: number };
const storageKey = "campusbite.student.recovery";
const empty: Saved = { email: "", attempt: "", until: 0 };

type Widget = {
  render(container: HTMLElement, options: object): string;
  remove(id: string): void;
};
function Challenge({ siteKey, onToken }: { siteKey: string; onToken: (value: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const api = (window as Window & { turnstile?: Widget }).turnstile;
    if (!ready || !api || !element.current) return;
    const id = api.render(element.current, { sitekey: siteKey, action: "student-recovery", callback: onToken,
      "expired-callback": () => onToken(""), "error-callback": () => { onToken(""); setFailed(true); } });
    return () => api.remove(id);
  }, [onToken, ready, siteKey]);
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)} onError={() => setFailed(true)} />
    <div ref={element} />{failed && <Notice>Verification could not load. Refresh the page and try again.</Notice>}</>;
}

export function StudentRecovery({ linkAttempt, grantAttempt, siteKey }: { linkAttempt?: string; grantAttempt?: string; siteKey?: string }) {
  const [stage, setStage] = useState<Stage>("request");
  const [saved, setSaved] = useState<Saved>(empty);
  const [linkToken, setLinkToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [widgetVersion, setWidgetVersion] = useState(0);

  useEffect(() => {
    let previous = empty;
    try { previous = JSON.parse(sessionStorage.getItem(storageKey) || "null") || empty; } catch { /* Storage is optional. */ }
    setSaved(previous);
    const token = new URLSearchParams(window.location.hash.slice(1)).get("recovery");
    if (linkAttempt && token) {
      setLinkToken(token);
      setStage("link");
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } else if (grantAttempt && (!linkAttempt || grantAttempt === linkAttempt)) setStage("password");
    else if (linkAttempt) { setStage("link"); setMessage("Reopen the link in your recovery email or request another email."); }
    else if (previous.attempt) setStage("code");
    setNow(Date.now());
    setHydrated(true);
  }, []); // Read the fragment once, before removing it from browser history.

  useEffect(() => {
    if (!saved.until || Date.now() >= saved.until) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= saved.until) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [saved.until]);
  const wait = Math.max(0, Math.ceil((saved.until - now) / 1000));
  function remember(value: Saved) {
    setSaved(value);
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Continue in memory. */ }
  }
  async function send() {
    const result = await requestRecovery(saved.email, challengeToken);
    setChallengeToken("");
    setWidgetVersion(n => n + 1);
    setChallenge(!!result.challenge);
    if (result.wait) {
      setNow(Date.now());
      remember({ ...saved, attempt: result.attempt ?? saved.attempt, until: Date.now() + result.wait * 1000 });
    }
    if (result.attempt) setStage("code");
    setMessage(result.error || "If an account exists for this email, we’ve sent password-reset instructions.");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      if (stage === "request" || form.get("resend")) { await send(); return; }
      if (stage === "password") {
        const result = await setRecoveredPassword(form);
        if (result.done || result.restart) { remember(empty); setStage(result.done ? "done" : "request"); }
        setMessage(result.error || "");
        return;
      }
      const result = stage === "link" ? await verifyStudentRecovery(linkAttempt || "", "link", linkToken)
        : await verifyStudentRecovery(saved.attempt, "code", String(form.get("code") || ""), saved.email);
      if (result.verified) { setLinkToken(""); setStage("password"); remember(empty); }
      setMessage(result.error || "");
    } catch { setMessage("Recovery is temporarily unavailable. Please try again."); }
    finally { setPending(false); }
  }
  function startAgain() {
    setStage("request");
    setMessage("");
    setLinkToken("");
    setChallenge(false);
    setChallengeToken("");
    remember({ ...saved, attempt: "" });
    if (linkAttempt) window.history.replaceState(window.history.state, "", "/recovery");
  }
  const canSend = hydrated && !pending && !wait && (!challenge || !!challengeToken);
  const resendLabel = wait ? "Resend in " + wait + "s" : "Resend email";
  const title = { request: "Reset your password", code: "Verify your recovery code", link: "Confirm your recovery link",
    password: "Set a new password", done: "Password updated" }[stage];
  return <div className="narrow auth"><Back href="/sign-in">Sign in</Back><h1>{title}</h1>
    <section className="panel panel-pad stack">
      {stage === "done" ? <><p>You can now sign in with your new password.</p><Link className="button" href="/sign-in">Sign in</Link></> : <>
        <form key={stage} className="stack" onSubmit={submit}>
          {stage === "request" && <><label className="field">Email<input name="email" type="email" autoComplete="email" required maxLength={254}
            value={saved.email} onChange={e => { setSaved({ ...saved, email: e.target.value, until: 0, attempt: "" }); }} /></label>
            <p>If you usually sign in with Google, you can continue using Google on the sign-in page.</p>
            {challenge && siteKey && <Challenge key={widgetVersion} siteKey={siteKey} onToken={setChallengeToken} />}
            <button className="button" disabled={!canSend}>{wait ? resendLabel : "Email a code"}</button></>}
          {stage === "code" && <><p>Enter the code sent to {saved.email}, or open the reset link in the email.</p>
            <label className="field">Verification code<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" required /></label>
            <button className="button" disabled={pending}>Verify code</button></>}
          {stage === "link" && <><p>Confirm this link to choose a new password for your CampusBite account.</p>
            <button className="button" disabled={pending || !linkToken}>Confirm recovery link</button></>}
          {stage === "password" && <><label className="field">New password<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></label>
            <label className="field">Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></label>
            <button className="button" disabled={pending}>Save new password</button></>}
        </form>
        {stage === "code" && <form className="stack" onSubmit={submit}><input type="hidden" name="resend" value="1" />
          {challenge && siteKey && <Challenge key={widgetVersion} siteKey={siteKey} onToken={setChallengeToken} />}
          <button className="button secondary" disabled={!canSend}>{resendLabel}</button></form>}
        {(stage === "link" || stage === "code") && <button className="text-link" disabled={pending} onClick={startAgain}>Start a new request</button>}
        {message && <Notice>{message}</Notice>}
      </>}
    </section></div>;
}
