import "server-only";
import type { Session } from "@supabase/supabase-js";
import { staffService, staffSession, verifiedProviderSessionId } from "./supabase";

export async function registerVendorLogin(service: NonNullable<ReturnType<typeof staffService>>, session: Session, googleSubject?: string) {
  const loginSession = await verifiedProviderSessionId(service, session);
  if (!loginSession || !session.user.email) return false;
  const registration = await service.rpc("register_vendor_session", {
    login_session: loginSession, login_user: session.user.id, login_email: session.user.email.toLowerCase(), google_subject: googleSubject,
  });
  return !registration.error && registration.data === true;
}

export async function vendorSession(writeCookies = false) {
  const session = await staffSession(writeCookies);
  if (!session) return null;
  const { data, error } = await session.client.rpc("campusbite_vendor_session");
  return !error && data === true ? session : null;
}
