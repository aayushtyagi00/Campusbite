"use server";

import { randomUUID } from "node:crypto";
import { verifyChallenge } from "./turnstile";
import { requestNetwork } from "./request-network";
import { createClient } from "@supabase/supabase-js";
import { commerceDb, orderUuid } from "./commerce";
import { studentSettings } from "./student-auth";
import { clearRecoveryGrant, openRecoveryValue, recoveryGrant, recoveryHash, saveRecoveryGrant, sealRecoveryValue } from "./student-recovery";

type Result = { error?: string; attempt?: string; wait?: number; challenge?: boolean; verified?: boolean; done?: boolean; restart?: boolean };
const unavailable = "Recovery is temporarily unavailable. Please try again.";
const expired = "This recovery attempt has expired or has already been used. Request a new email.";
const emailKey = (email: string) => recoveryHash("email", email.trim().toLowerCase());
const isolatedAuth = (url: string, key: string) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export async function requestRecovery(address: string, challengeToken = ""): Promise<Result> {
  if (typeof address !== "string" || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()))
    return { error: "Enter a valid email address." };
  const settings = studentSettings();
  if (!settings?.origin) return { error: unavailable };
  try {
    const email = address.trim().toLowerCase();
    const network = await requestNetwork();
    const passed = typeof challengeToken === "string" && !!challengeToken && await verifyChallenge(challengeToken, settings.origin, "student-recovery");
    const { data, error } = await commerceDb().rpc("student_request_recovery", {
      email_hash: emailKey(email), ip_hash: network ? recoveryHash("ip", network) : recoveryHash("network-unavailable/email", email),
      challenge_passed: passed,
    });
    if (error || !data) return { error: unavailable };
    if (data.challenge) return { challenge: true, error: process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY
      ? "Complete the verification below to request an email." : "Recovery verification is temporarily unavailable on this network. Try again later." };
    if (!data.attempt) return { wait: data.wait, error: "Please wait before requesting another recovery email." };
    const sent = await isolatedAuth(settings.url, settings.key).auth.resetPasswordForEmail(email, {
      redirectTo: settings.origin + "/recovery/" + data.attempt,
    });
    if (sent.error && (sent.error.status === 429 || !sent.error.status || sent.error.status >= 500))
      return { error: "Email delivery is temporarily unavailable. Try again after the countdown.", wait: data.wait };
    return { attempt: data.attempt, wait: data.wait };
  } catch { return { error: unavailable }; }
}

export async function verifyStudentRecovery(attempt: string, method: "link" | "code", credential: string, address = ""): Promise<Result> {
  const settings = studentSettings();
  if (!settings || typeof attempt !== "string" || !orderUuid.test(attempt) || typeof credential !== "string" ||
      typeof address !== "string" || address.length > 254 || (method !== "code" && method !== "link")) return { error: expired };
  try {
    const db = commerceDb();
    const lease = randomUUID();
    const start = await db.rpc("student_check_recovery", { attempt, email_hash: method === "code" ? emailKey(address) : null, lease });
    if (start.error) return { error: unavailable };
    const locked = "Five unsuccessful checks locked this attempt. Request a new recovery email.";
    if (start.data === "locked") return { error: locked };
    if (start.data === "busy") return { error: "A verification is in progress. Please wait a moment." };
    if (start.data !== "ok") return { error: expired };
    const proof = randomUUID();
    let access: string | undefined;
    let email: string | undefined;
    let transient = false;
    if (method === "link" ? /^[a-zA-Z0-9_-]{32,256}$/.test(credential) : /^\d{6,10}$/.test(credential)) {
      try {
        const result = await isolatedAuth(settings.url, settings.key).auth.verifyOtp(method === "link"
          ? { type: "recovery", token_hash: credential }
          : { type: "recovery", token: credential, email: address.trim().toLowerCase() });
        transient = !!result.error && (!result.error.status || result.error.status >= 500 || result.error.status === 429);
        access = result.data.session?.access_token;
        email = result.data.user?.email;
      } catch { transient = true; }
    }
    const finished = await db.rpc("student_finish_check", { attempt, lease, transient,
      verified_email_hash: email && access ? emailKey(email) : null, proof_hash: recoveryHash("grant", proof),
      sealed_token: access ? sealRecoveryValue(access) : null });
    if (finished.error || transient) return { error: unavailable };
    if (finished.data === "locked") return { error: locked };
    if (finished.data !== "verified") return { error: "This code or link is invalid, expired, or already used." };
    await saveRecoveryGrant({ attempt, proof, expires: Date.now() + 600_000 });
    return { verified: true };
  } catch { return { error: unavailable }; }
}

export async function setRecoveredPassword(form: FormData): Promise<Result> {
  const password = form.get("password");
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72)
    return { error: "Use at least 8 characters and at most 72 UTF-8 bytes." };
  if (password !== form.get("confirmation")) return { error: "The passwords do not match." };
  const settings = studentSettings();
  const grant = await recoveryGrant();
  if (!settings || !grant) return { error: expired, restart: true };
  try {
    const result = await commerceDb().rpc("student_consume_recovery", { attempt: grant.attempt, proof_hash: recoveryHash("grant", grant.proof) });
    if (result.error) return { error: unavailable };
    await clearRecoveryGrant();
    if (!result.data) return { error: expired, restart: true };
    const authHeaders = { apikey: settings.key, Authorization: "Bearer " + openRecoveryValue(result.data), "Content-Type": "application/json" };
    const updated = await fetch(settings.url + "/auth/v1/user", { method: "PUT", headers: authHeaders,
      body: JSON.stringify({ password }), cache: "no-store", signal: AbortSignal.timeout(10000) });
    const scope = updated.ok ? "global" : "local";
    const revoked = await fetch(settings.url + "/auth/v1/logout?scope=" + scope, { method: "POST", headers: authHeaders,
      signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!updated.ok) return { error: "Password update failed. Request a new email and choose a different password.", restart: true };
    if (!revoked?.ok) return { error: "Password updated. Other sessions could not be confirmed signed out. Contact support if you suspect account misuse.", restart: true };
    return { done: true };
  } catch { return { error: "Could not confirm the password change. Try signing in or request a new recovery email.", restart: true }; }
}
