import "server-only";
import type { Session } from "@supabase/supabase-js";

export async function verifiedGoogleSubject(session: Session) {
  if (!session.provider_token || !session.user.email_confirmed_at || !session.user.email) return null;
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + session.provider_token },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const profile = await response.json();
    if (profile?.email_verified !== true || typeof profile.email !== "string" ||
      profile.email.toLowerCase() !== session.user.email.toLowerCase() ||
      typeof profile.sub !== "string" || !profile.sub || profile.sub.length > 255) return null;
    return profile.sub as string;
  } catch {
    return null;
  }
}
