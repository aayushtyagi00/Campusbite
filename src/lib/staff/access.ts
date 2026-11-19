import "server-only";

import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { isStaffCookie, staffClient, staffService, staffSession, verifiedStaffSession } from "./supabase";
import type { StaffArea } from "./database";
import type { User } from "@supabase/supabase-js";

export function isStaffArea(area: unknown): area is StaffArea {
  return area === "admin" || area === "vendor";
}

export function staffDashboard(area: StaffArea) {
  return area === "admin" ? "/admin" : "/vendor/dashboard";
}

export async function adminSession(writeCookies = false) {
  if (!(await cookies()).getAll().some(({ name }) => isStaffCookie(name))) return null;
  const client = await staffClient(writeCookies);
  if (!client) return null;
  const [session, { data, error }] = await Promise.all([
    verifiedStaffSession(client), client.rpc("campusbite_is_admin"),
  ]);
  return !error && data === true ? session : null;
}

export async function vendorMemberships(session: NonNullable<Awaited<ReturnType<typeof staffSession>>>) {
  return session.client.from("vendor_access")
    .select("shop_id,email,role,created_at").eq("email", session.email).order("created_at");
}

type StaffService = NonNullable<ReturnType<typeof staffService>>;

export async function invited(service: StaffService, area: StaffArea, email: string) {
  if (area === "admin") {
    const { data, error } = await service.from("staff_admins").select("email").eq("email", email).maybeSingle();
    return !error && Boolean(data);
  }
  const { data, error } = await service.from("vendor_access").select("shop_id").eq("email", email).limit(1);
  return !error && Boolean(data?.length);
}

export async function invitedUser(service: StaffService, area: StaffArea, user: User | null, expectedEmail?: string) {
  const email = user?.email?.toLowerCase();
  return Boolean(user?.email_confirmed_at && email &&
    (expectedEmail === undefined || email === expectedEmail) && await invited(service, area, email));
}

export async function allowAttempt(service: StaffService, bucket: string, key: string, limit: number, seconds: number) {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) return false;
  const hash = createHmac("sha256", secret).update(key).digest("hex");
  const { data, error } = await service.rpc("campusbite_consume_attempt", {
    p_bucket: bucket,
    p_key_hash: hash,
    p_limit: limit,
    p_seconds: seconds,
  });
  return !error && data === true;
}
