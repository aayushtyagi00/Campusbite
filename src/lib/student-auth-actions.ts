"use server";

import { cookies } from "next/headers";
import { clearDeviceAlerts } from "./push-device";
import { allowAttempt, allowNetworkAttempt } from "./staff/access";
import { staffService } from "./staff/supabase";
import { commerceDb } from "./commerce";
import { redirect } from "next/navigation";
import { clearStudentCookies, studentClient, studentReturnCookie, studentSettings } from "./student-auth";
import { clearRecoveryGrant } from "./student-recovery";
import { publicFormVerified } from "./turnstile";

export async function saveStudentProfile(form: FormData) {
  const client = await studentClient(true);
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) return { error: "Enter a display name of up to 80 characters." };
  if (!client) return { error: "Sign in to update your account." };
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous) return { error: "Sign in to update your account." };
  const orderAlerts = form.get("orderAlerts") === "on";
  const refundAlerts = form.get("refundAlerts") === "on";
  const { error } = await client.auth.updateUser({ data: { campusbite_name: name,
    campusbite_order_alerts: orderAlerts, campusbite_refund_alerts: refundAlerts } });
  if (!error && process.env.VAPID_PRIVATE_KEY) {
    const sync = await commerceDb().from("push_subscriptions").update({
      order_alerts: orderAlerts, refund_alerts: refundAlerts,
    }).eq("student_id", user.id);
    if (sync.error) return { error: "Profile saved. Save again to sync device notifications." };
  }
  return error ? { error: "Your changes could not be saved. Please try again." } : { saved: true };
}

export async function studentAuth(operation: "sign-in" | "sign-up" | "confirm" | "google" | "sign-out", form: FormData) {
  const client = await studentClient(true);
  const settings = studentSettings();
  const destination = form.get("returnTo") === "checkout" ? "/checkout" : "/account";
  if (!["sign-in", "sign-up", "confirm", "google", "sign-out"].includes(operation)) return { error: "Invalid sign-in request." };
  if (operation === "sign-out") {
    try { await clearDeviceAlerts("student"); } catch { /* Sign-out must remain available if the notification database is offline. */ }
    let revoked = false;
    try {
      if (client) revoked = !(await client.auth.signOut({ scope: "local" })).error;
    } catch { /* Local credentials must be cleared when the provider is unreachable. */ }
    await clearStudentCookies();
    await clearRecoveryGrant();
    redirect(revoked ? "/sign-in" : "/sign-in?logout=device");
  }
  if (!client || !settings) return { error: "Student authentication is temporarily unavailable." };
  if (operation === "google") {
    if (!settings.origin) return { error: "Google sign-in is unavailable until the student site address is configured." };
    const { error, data } = await client.auth.signInWithOAuth({
      provider: "google", options: { redirectTo: settings.origin + "/auth/student/callback" },
    });
    if (error || !data.url) return { error: "Google sign-in is temporarily unavailable." };
    (await cookies()).set(studentReturnCookie, destination, {
      httpOnly: true, sameSite: "lax", secure: settings.origin.startsWith("https:"), path: "/auth/student/callback", maxAge: 600,
    });
    redirect(data.url);
  }
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const token = String(form.get("code") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (operation === "confirm") {
    if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code from your email." };
  } else if (password.length < 8 || password.length > 72) return { error: "Enter a password between 8 and 72 characters." };
  const name = String(form.get("name") ?? "").trim();
  if (operation === "sign-up") {
    if (Buffer.byteLength(password, "utf8") > 72) return { error: "Use a password of at most 72 UTF-8 bytes." };
    if (!name || name.length > 80) return { error: "Enter a display name of up to 80 characters." };
    if (password !== form.get("confirmation")) return { error: "The passwords do not match." };
    if (!settings.origin) return { error: "Registration is unavailable until the student site address is configured." };
    const verified = await publicFormVerified(form.get("cf-turnstile-response"), "student-signup");
    if (verified === null) return { error: "Registration verification is temporarily unavailable." };
    if (!verified)
      return { error: "Complete the verification and try creating your account again." };
  }
  const service=staffService();
  const limit=operation==="sign-up" ? 5 : 15;
  if (!service || !await allowNetworkAttempt(service,"student-"+operation+"-network",120,900) ||
      !await allowAttempt(service,"student-"+operation,email,limit,900))
    return {error:"Please wait before trying again."};
  if (operation === "confirm") {
    const { error } = await client.auth.verifyOtp({ email, token, type: "email" });
    if (error) return { error: "That code is invalid or expired." };
    redirect(destination);
  }
  if (operation === "sign-up") {
    const { data, error } = await client.auth.signUp({ email, password, options: {
      emailRedirectTo: settings.origin + "/auth/student/callback", data: { campusbite_name: name },
    } });
    if (error) return { error: "Could not create an account. Check your details or try again later." };
    if (data.session) redirect(destination);
    return { next: "confirm" as const };
  }
  if (operation !== "sign-in") return { error: "Invalid sign-in request." };
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { error: "Sign-in failed. Check your email and password and confirm your email address." };
  redirect(destination);
}
