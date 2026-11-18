import { NextRequest, NextResponse } from "next/server";
import { studentClient, studentSettings } from "@/lib/student-auth";

export async function GET(request: NextRequest) {
  const settings = studentSettings();
  if (!settings) return new NextResponse("Sign-in is unavailable", { status: 503 });
  const client = await studentClient(true);
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") === "/checkout" ? "/checkout" : "/account";
  const result = client && code ? await client.auth.exchangeCodeForSession(code) : null;
  const response = NextResponse.redirect(new URL(result && !result.error ? next : "/sign-in?error=google", settings.origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
