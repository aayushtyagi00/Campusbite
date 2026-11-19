import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { StaffDatabase } from "@/lib/staff/database";
import { isStaffCookie, staffSettings } from "@/lib/staff/supabase";
import { createStudentClient, studentCookie, studentSettings } from "@/lib/student-auth";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (request.nextUrl.pathname.startsWith("/vendor/onboarding") || ["orders", "checkout", "account", "sign-in", "recovery"].includes(request.nextUrl.pathname.split("/")[1])) {
    const settings = studentSettings();
    if (settings && request.method === "GET" && request.cookies.getAll().some(({ name }) => name === studentCookie || name.startsWith(studentCookie + "."))) {
      const client = createStudentClient(settings, () => request.cookies.getAll(), entries => {
        for (const { name, value } of entries) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of entries) response.cookies.set(name, value, options);
      });
      // Refresh expiring cookies here. Protected pages and actions independently verify identity.
      await client.auth.getSession();
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const settings = staffSettings();
  const hasSession = request.cookies.getAll().some(({ name }) => isStaffCookie(name));
  if (settings && hasSession && (request.method === "GET" || request.method === "HEAD")) {
    const client = createServerClient<StaffDatabase>(settings.url, settings.key, {
      cookieOptions: settings.cookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(entries) {
          for (const { name, value } of entries) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of entries) response.cookies.set(name, value, options);
        },
      },
    });
    await client.auth.getSession();
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/admin/:path*", "/vendor/:path*", "/orders/:path*", "/checkout", "/account", "/sign-in", "/recovery"] };
