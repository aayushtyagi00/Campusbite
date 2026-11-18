import { cookies } from "next/headers";
import { authRedirect } from "@/lib/auth-redirect";
import { studentClient, studentReturnCookie } from "@/lib/student-auth";

export async function GET(request: Request) {
  const jar = await cookies();
  const query = new URL(request.url).searchParams;
  const destination = jar.get(studentReturnCookie)?.value ?? query.get("next");
  jar.set(studentReturnCookie, "", { path: "/auth/student/callback", maxAge: 0 });
  const client = await studentClient(true);
  const code = query.get("code");
  if (client && code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (!error && data.session) return authRedirect(destination === "/checkout" ? "/checkout" : "/account");
  }
  return authRedirect("/sign-in?error=google");
}
