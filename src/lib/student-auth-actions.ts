"use server";

import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { studentClient, studentSettings } from "./student-auth";

export async function studentAuth(operation: "sign-in" | "sign-up" | "confirm" | "send-reset" | "reset" | "google" | "sign-out", form: FormData) {
  const client = await studentClient(true);
  const settings = studentSettings();
  if (!client || !settings) return { error: "Student authentication is temporarily unavailable." };
  const destination = form.get("returnTo") === "checkout" ? "/checkout" : "/account";
  if (operation === "sign-out") {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) return { error: "Could not sign out. Please try again." };
    redirect("/sign-in");
  }
  if (operation === "google") {
    const { error, data } = await client.auth.signInWithOAuth({
      provider: "google", options: { redirectTo: settings.origin + "/auth/student/callback?next=" + destination },
    });
    if (error || !data.url) return { error: "Google sign-in is temporarily unavailable." };
    redirect(data.url);
  }
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const token = String(form.get("code") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (operation === "send-reset") {
    const { error } = await client.auth.resetPasswordForEmail(email);
    if (error?.status === 429) return { error: "Please wait before requesting another code." };
    return { next: "reset" as const };
  }
  if (operation === "confirm") {
    if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code from your email." };
    const { error } = await client.auth.verifyOtp({ email, token, type: "email" });
    if (error) return { error: "That code is invalid or expired." };
    redirect(destination);
  }
  if (password.length < 8 || password.length > 72) return { error: "Enter a password between 8 and 72 characters." };
  if (operation === "reset") {
    if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code from your email." };
    const recovery = createClient(settings.url, settings.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await recovery.auth.verifyOtp({ email, token, type: "recovery" });
    if (verified.error) return { error: "That code is invalid or expired." };
    const updated = await recovery.auth.updateUser({ password });
    await recovery.auth.signOut({ scope: "local" });
    if (updated.error) return { error: "Could not update the password. Request another code and choose a different password." };
    redirect("/sign-in");
  }
  if (operation === "sign-up") {
    const { error } = await client.auth.signUp({ email, password });
    if (error) return { error: "Could not create an account. Check your details or try again later." };
    return { next: "confirm" as const };
  }
  if (operation !== "sign-in") return { error: "Invalid sign-in request." };
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { error: "Sign-in failed. Check your email and password and confirm your email address." };
  redirect(destination);
}
