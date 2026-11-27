import "server-only";

import type { Session } from "@supabase/supabase-js";
import { staffService, verifiedProviderSessionId } from "./supabase";

export async function registerAdminLogin(service: NonNullable<ReturnType<typeof staffService>>, session: Session, googleSubject: string) {
  const sessionId = await verifiedProviderSessionId(service, session);
  if (!sessionId) return false;
  const { data, error } = await service.rpc("register_admin_session", {
    login_session: sessionId, login_user: session.user.id, google_subject: googleSubject,
  });
  return !error && data === true;
}
