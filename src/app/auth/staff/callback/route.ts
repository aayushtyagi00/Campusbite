import { cookies } from "next/headers";
import { invitedUser, isStaffArea, staffDashboard } from "@/lib/staff/access";
import { clearStaffOAuthCookies, staffClient, staffOAuthAreaCookie, staffOAuthCookieName, staffOrigin, staffService } from "@/lib/staff/supabase";
import { authRedirect } from "@/lib/auth-redirect";

export async function GET(request: Request) {
  const area = (await cookies()).get(staffOAuthAreaCookie)?.value;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const failure = () => authRedirect(area === "admin" ? "/admin/sign-in?error=google" : "/vendor/sign-in?error=google");
  try {
    if (!code || !isStaffArea(area) || !staffOrigin()) return failure();
    const service = staffService();
    const exchange = await staffClient(false, staffOAuthCookieName);
    if (!service || !exchange) return failure();
    const { data, error } = await exchange.auth.exchangeCodeForSession(code);
    if (error || !data.session || !data.user?.identities?.some(identity => identity.provider === "google") ||
      !await invitedUser(service, area, data.user)) {
      if (data.session) await exchange.auth.signOut({ scope: "local" });
      return failure();
    }
    const client = await staffClient(true);
    if (!client) return failure();
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.session.access_token, refresh_token: data.session.refresh_token,
    });
    return sessionError ? failure() : authRedirect(staffDashboard(area));
  } finally {
    await clearStaffOAuthCookies();
  }
}
