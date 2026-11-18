import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { staffOrigin } from "./staff/supabase";

export const studentCookie = "campusbite-student-auth";
export const liveStudent = () => process.env.CAMPUSBITE_MODE === "live";

export function studentSettings() {
  const url = process.env.STUDENT_SUPABASE_URL?.trim();
  const key = process.env.STUDENT_SUPABASE_PUBLISHABLE_KEY?.trim();
  const origin = staffOrigin();
  if (!liveStudent() || !url || !key || !origin) return null;
  return { url, key, origin };
}

export function createStudentClient(
  settings: NonNullable<ReturnType<typeof studentSettings>>,
  getAll: () => { name: string; value: string }[],
  setAll: (entries: { name: string; value: string; options: CookieOptions }[]) => void,
) {
  return createServerClient(settings.url, settings.key, {
    cookieOptions: { name: studentCookie, path: "/", httpOnly: true, sameSite: "lax", secure: settings.origin.startsWith("https:") },
    cookies: { getAll, setAll },
  });
}

export async function studentClient(write = false) {
  const settings = studentSettings();
  if (!settings) return null;
  const jar = await cookies();
  return createStudentClient(settings, () => jar.getAll(), entries => {
    if (write) for (const { name, value, options } of entries) jar.set(name, value, options);
  });
}

export async function studentIdentity(write = false) {
  const client = await studentClient(write);
  if (!client) return null;
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || !claims.email || claims.role !== "authenticated" || claims.is_anonymous) return null;
  return { id: claims.sub, email: claims.email };
}
