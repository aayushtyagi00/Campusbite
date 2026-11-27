import "server-only";
import { portalOrigin } from "./auth-redirect";

type Action = "student-recovery" | "student-signup" | "public-review";

export async function verifyChallenge(token: unknown, origin: string, action: Action) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error",
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.action === action && result.hostname === new URL(origin).hostname;
  } catch { return false; }
}

export async function publicFormVerified(token: unknown, action: "student-signup" | "public-review") {
  if (!process.env.TURNSTILE_SITE_KEY && !process.env.TURNSTILE_SECRET_KEY &&
    process.env.CAMPUSBITE_MODE !== "live" && process.env.VERCEL_ENV !== "production") return true;
  const origin = portalOrigin("student");
  if (!origin || !process.env.TURNSTILE_SITE_KEY?.trim() || !process.env.TURNSTILE_SECRET_KEY?.trim()) return null;
  return verifyChallenge(token, origin, action);
}
