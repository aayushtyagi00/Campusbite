import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { StaffDatabase } from "./database";

export const staffCookieName = "campusbite-staff";
export const staffOAuthCookieName = "campusbite-staff-oauth";
export const staffOAuthAreaCookie = staffOAuthCookieName + "-portal";
export const isStaffCookie = (name: string) => name === staffCookieName || name.startsWith(staffCookieName + ".");

export function staffOrigin() {
  try {
    const origin = new URL(process.env.CAMPUSBITE_STAFF_ORIGIN?.trim() ?? "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) return null;
    if (origin.protocol === "https:" || (loopback && origin.protocol === "http:")) return origin.origin;
  } catch { /* Google sign-in requires an explicitly configured site origin. */ }
  return null;
}

export function staffSettings() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  const local = staffOrigin()?.startsWith("http:") ?? false;
  return { url, key, cookieOptions: { name: staffCookieName, httpOnly: true, path: "/", sameSite: "lax" as const, secure: !local } };
}

export function staffConfigured() {
  return Boolean(staffSettings() && process.env.SUPABASE_SECRET_KEY?.trim());
}

export async function staffClient(writeCookies = false, cookieName = staffCookieName) {
  const settings = staffSettings();
  if (!settings) return null;
  const jar = await cookies();
  return createServerClient<StaffDatabase>(settings.url, settings.key, {
    cookieOptions: { ...settings.cookieOptions, name: cookieName },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(entries) {
        if (!writeCookies) return;
        for (const { name, value, options } of entries) {
          jar.set(name, value, cookieName === staffOAuthCookieName && options.maxAge !== 0
            ? { ...options, maxAge: 600 } : options);
        }
      },
    },
  });
}

export function staffAuthAttempt() {
  const settings = staffSettings();
  if (!settings) return null;
  return createClient<StaffDatabase>(settings.url, settings.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function staffService() {
  const settings = staffSettings();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!settings || !secret) return null;
  return createClient<StaffDatabase>(settings.url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function staffSession(writeCookies = false) {
  const client = await staffClient(writeCookies);
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email || !data.user.email_confirmed_at) return null;
  return { client, email: data.user.email.toLowerCase() };
}

export async function clearStaffCookies() {
  const jar = await cookies();
  for (const { name } of jar.getAll()) if (isStaffCookie(name)) jar.delete(name);
}

export async function clearStaffOAuthCookies() {
  const jar = await cookies();
  for (const { name } of jar.getAll()) {
    if (name.startsWith(staffOAuthCookieName + "-") || name.startsWith(staffOAuthCookieName + ".") || name === staffOAuthCookieName) {
      jar.delete(name);
    }
  }
}
