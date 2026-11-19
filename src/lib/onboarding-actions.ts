"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { categories, foodCourts, type Category } from "./campus";
import { orderUuid } from "./commerce";
import { adminSession, allowAttempt } from "./staff/access";
import { staffService } from "./staff/supabase";
import { studentClient } from "./student-auth";
import { applicantSession } from "./vendor-applicant";

type Feedback = { message: string; error?: boolean };
const fail = (message: string): Feedback => ({ message, error: true });
const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const editable = ["draft", "changes_requested"] as const;

export async function applicantCode(verify: boolean, form: FormData) {
  const email = field(form, "email").toLowerCase();
  const auth = await studentClient(true);
  const db = staffService();
  if (!auth || !db || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid contact email.");
  if (verify) {
    if (!await allowAttempt(db, "applicant-verify", email, 8, 900)) return fail("Please wait before trying another code.");
    const { error } = await auth.auth.verifyOtp({ email, token: field(form, "code"), type: "email" });
    if (error) return fail("That email code is invalid or expired.");
    const name = field(form, "shop_name").slice(0, 100);
    redirect("/vendor/onboarding" + (name ? "?name=" + encodeURIComponent(name) : ""));
  }
  if (!await allowAttempt(db, "applicant-email", email, 1, 60) || !await allowAttempt(db, "applicant-hour", email, 5, 3600))
    return fail("Please wait before requesting another email.");
  const { error } = await auth.auth.signInWithOtp({ email });
  return error ? fail("Could not send the verification code.") : { message: "Enter the code sent to your contact email." };
}

export async function saveApplication(id: string, revision: number, submit: boolean, form: FormData): Promise<Feedback> {
  const actor = await applicantSession(true);
  if (!actor || !orderUuid.test(id)) return fail("Verify your contact email to continue.");
  const shop_name = field(form, "shop_name"), contact_name = field(form, "contact_name"), phone = field(form, "phone");
  const location = field(form, "location"), description = field(form, "description"), registration = field(form, "registration");
  const court = field(form, "court"), cuisine = field(form, "cuisine");
  const opens = field(form, "opens") || null, closes = field(form, "closes") || null;
  if (shop_name.length < 2 || shop_name.length > 100 || contact_name.length > 100 || phone.length > 24 ||
    location.length > 150 || description.length > 1200 || registration.length > 240 || cuisine.length > 120 ||
    (court && !foodCourts.some(c => c.id === court)) || [opens, closes].some(t => t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))
    return fail("Check the shop name and business details.");
  if (submit && (contact_name.length < 2 || !/^[+\d ().-]{7,24}$/.test(phone) || phone.replace(/\D/g, "").length < 7 ||
    location.length < 2 || cuisine.length < 2 || !court || !opens || !closes || closes <= opens || !registration))
    return fail("Complete the contact, stall, registration and opening-hours fields before submitting.");
  if (submit && form.get("agreement") !== "on") return fail("Read and accept the vendor agreement before submitting.");
  const now = new Date().toISOString();
  const values = {
    email: actor.email, applicant_id: actor.id, shop_name, contact_name, phone, location, description, registration, court, cuisine, opens, closes,
    verified_at: now, ...(submit ? { status: "submitted" as const, agreement_version: "pilot-v1", agreed_at: now } : {}), revision: revision + 1
  };
  if (revision === -1 && !await allowAttempt(actor.db, "new-vendor-application", actor.email, 10, 3600)) return fail("Please try again later.");
  const query = revision === -1
    ? actor.db.from("vendor_applications").insert({ ...values, id, status: submit ? "submitted" : "draft" })
    : actor.db.from("vendor_applications").update(values).eq("id", id).eq("email", actor.email).or(actor.ownership).eq("revision", revision).in("status", editable);
  const result = await query.select("id").maybeSingle();
  if (result.error || !result.data) return fail("The application could not be saved. Reload to check its latest version.");
  revalidatePath("/vendor/onboarding", "layout");
  revalidatePath("/admin/applications");
  if (revision === -1) redirect("/vendor/onboarding/" + id);
  return { message: submit ? "Application submitted for review." : "Draft saved." };
}

export async function changeDocument(id: string, revision: number, removePath: string | null, _state: Feedback, form: FormData): Promise<Feedback> {
  const actor = await applicantSession(true);
  if (!actor || !orderUuid.test(id)) return fail("Verify your email first.");
  const application = actor.db.from("vendor_applications");
  const { data } = await application.select("documents").eq("id", id).eq("email", actor.email).or(actor.ownership)
    .eq("revision", revision).in("status", editable).maybeSingle();
  if (!data) return fail("Reload the application before editing documents.");
  const storage = actor.db.storage.from("vendor-onboarding");
  let documents = data.documents;
  let uploaded: string | undefined;
  if (removePath) {
    if (!documents.some(d => d.path === removePath)) return fail("Document unavailable.");
    documents = documents.filter(d => d.path !== removePath);
  } else {
    const file = form.get("document");
    if (documents.length >= 4 || !(file instanceof File) || file.size > 3 * 1024 * 1024 ||
      await file.slice(0, 5).text() !== "%PDF-") return fail("Choose a PDF up to 3 MB. Each application can hold four documents.");
    uploaded = id + "/" + randomUUID() + ".pdf";
    if ((await storage.upload(uploaded, file, { contentType: "application/pdf" })).error) return fail("The document upload failed.");
    documents = [...documents, { path: uploaded, name: file.name.slice(0, 150) }];
  }
  const result = await application.update({ documents, applicant_id: actor.id, revision: revision + 1 }).eq("id", id).eq("email", actor.email).or(actor.ownership)
    .eq("revision", revision).in("status", editable).select("id").maybeSingle();
  if (result.error || !result.data) {
    // Only discard an upload on a confirmed edit conflict. An interrupted response can follow a committed write.
    if (uploaded && !result.error) await storage.remove([uploaded]);
    return fail("Reload to check your application documents.");
  }
  if (removePath) await storage.remove([removePath]);
  revalidatePath("/vendor/onboarding/" + id);
  return { message: removePath ? "Document removed." : "Document saved." };
}

export async function reviewApplication(id: string, revision: number, _state: Feedback, form: FormData): Promise<Feedback> {
  const session = await adminSession(true);
  if (!session) return fail("Administrator access required.");
  const { error } = await session.client.rpc("review_vendor_application", {
    application_id: id, expected_revision: revision,
    decision: field(form, "decision"), note: field(form, "note"), existing_shop: field(form, "existing_shop") || undefined
  });
  if (error) return fail(error.code === "P0001" ? error.message : error.code === "23505"
    ? "This shop already exists. Select the existing shop to link it." : "Review could not be saved.");
  revalidatePath("/admin", "layout");
  revalidatePath("/vendor/onboarding", "layout");
  return { message: "Review saved." };
}

export async function saveStorefront(id: string, revision: number, _state: Feedback, form: FormData): Promise<Feedback> {
  const session = await adminSession(true);
  if (!session) return fail("Administrator access required.");
  const details = Object.fromEntries(["slug", "display_name", "court", "location", "cuisine", "opens", "closes", "capacity",
    "payment_status", "provider_ref", "standing"].map(key => [key, field(form, key)]));
  const { error } = await session.client.rpc("save_vendor_storefront", {
    target_shop: id, expected_revision: revision,
    details: { ...details, published: form.get("published") === "on", enabled: form.get("enabled") === "on" }
  });
  if (error) return fail(error.code === "P0001" ? error.message : "Check the storefront details and try again.");
  updateTag("campusbite-storefronts");
  revalidatePath("/admin", "layout");
  revalidatePath("/vendor/onboarding", "layout");
  return { message: "Storefront saved." };
}

export async function addOnboardingItem(shop: string, id: string, _state: Feedback, form: FormData): Promise<Feedback> {
  const session = await adminSession(true);
  if (!session || !orderUuid.test(shop) || !orderUuid.test(id)) return fail("Administrator access required.");
  const name = field(form, "name"), description = field(form, "description"), diet = field(form, "diet");
  const category = field(form, "category") as Category, priceInput = field(form, "price");
  const price = Math.round(Number(priceInput) * 100), prep = Number(field(form, "prep"));
  if (!name || name.length > 100 || !description || description.length > 500 || !diet || diet.length > 80 ||
    !categories.includes(category) || !/^\d+(\.\d{1,2})?$/.test(priceInput) || price < 100 || price > 1000000 ||
    !Number.isInteger(prep) || prep < 1 || prep > 50) return fail("Check the item details, price and preparation time.");
  const { data } = await session.client.from("commerce_stalls").select("slug").eq("shop_id", shop).maybeSingle();
  if (!data) return fail("Save the storefront first.");
  const result = await session.client.from("commerce_menu").insert({ id, stall_slug: data.slug, name, description, diet, category, price, prep, photo: "", sold_out: false });
  if (result.error) return fail(result.error.code === "23505" ? "This item has already been added. Reload the shop." : "The menu item could not be saved.");
  updateTag("campusbite-storefronts");
  revalidatePath("/admin/vendors/" + shop);
  return { message: "Menu item added." };
}
