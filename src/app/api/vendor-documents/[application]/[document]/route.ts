import { orderUuid } from "@/lib/commerce";
import { adminSession } from "@/lib/staff/access";
import { staffService } from "@/lib/staff/supabase";
import { applicantSession } from "@/lib/vendor-applicant";

export async function GET(_request: Request, { params }: { params: Promise<{ application: string; document: string }> }) {
  const { application, document } = await params;
  const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!orderUuid.test(application) || !document.endsWith(".pdf") || !orderUuid.test(document.slice(0, -4))) return missing();
  const admin = await adminSession();
  const applicant = admin ? null : await applicantSession();
  const db = staffService();
  if (!db || (!admin && !applicant)) return missing();
  const path = application + "/" + document;
  let query = db.from("vendor_applications").select("documents").eq("id", application);
  if (applicant) query = query.eq("email", applicant.email).or(applicant.ownership);
  const { data } = await query.maybeSingle();
  const item = data?.documents.find(d => d.path === path);
  if (!item) return missing();
  const file = await db.storage.from("vendor-onboarding").download(path);
  if (!file.data) return missing();
  return new Response(file.data, {
    headers: {
      "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(item.name.toWellFormed()).replace(/'/g, "%27"), "X-Content-Type-Options": "nosniff"
    }
  });
}
