import "server-only";
import { studentClient } from "./student-auth";
import { staffService } from "./staff/supabase";

export async function applicantSession(write = false) {
  const auth = await studentClient(write);
  const db = staffService();
  if (!auth || !db) return null;
  const { data: { user } } = await auth.auth.getUser();
  if (!user?.email_confirmed_at || !user.email) return null;
  // Legacy applications predate verified accounts. The first verified edit binds the account.
  return { db, email: user.email.toLowerCase(), id: user.id, ownership: "applicant_id.is.null,applicant_id.eq." + user.id };
}
