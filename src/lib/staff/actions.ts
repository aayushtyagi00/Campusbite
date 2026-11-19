"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminSession, allowAttempt, invited, invitedUser, isStaffArea, staffDashboard } from "./access";
import { clearStaffCookies, clearStaffOAuthCookies, staffAuthAttempt, staffClient, staffOAuthAreaCookie, staffOAuthCookieName, staffOrigin, staffService } from "./supabase";
import { vendorRoles, type StaffArea, type VendorRole } from "./database";

type FormState = { message: string; error?: boolean };
const invalidCredentials = "Could not sign in. Check your approved email and password or set a new password.";
const invalidCode = "The password setup code could not be verified. Check the code or request a new one.";
const unavailable = "The portal is temporarily unavailable. Please try again later.";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function emailField(form: FormData) {
  const email = field(form, "email").toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function failure(message: string): FormState { return { message, error: true }; }

export async function signInWithStaffPassword(area: StaffArea, _previous: FormState, form: FormData): Promise<FormState> {
  const email = emailField(form);
  const password = form.get("password");
  if (!email || typeof password !== "string" || !password || password.length > 512) return failure(invalidCredentials);
  const service = staffService();
  const attempt = staffAuthAttempt();
  if (!service || !attempt || !isStaffArea(area)) return failure(unavailable);
  if (!await invited(service, area, email) || !await allowAttempt(service, "staff-password", email, 12, 900)) return failure(invalidCredentials);
  const { data, error } = await attempt.auth.signInWithPassword({ email, password });
  if (error || !data.session) return failure(invalidCredentials);
  if (!await invitedUser(service, area, data.user, email)) {
    await attempt.auth.signOut({ scope: "local" });
    return failure(invalidCredentials);
  }
  const client = await staffClient(true);
  if (!client) return failure(unavailable);
  const { error: sessionError } = await client.auth.setSession({
    access_token: data.session.access_token, refresh_token: data.session.refresh_token,
  });
  if (sessionError) return failure(invalidCredentials);
  redirect(staffDashboard(area));
}

export async function startStaffGoogle(area: StaffArea, _previous: FormState, _form: FormData): Promise<FormState> {
  const origin = staffOrigin();
  const service = staffService();
  if (!origin || !service || !isStaffArea(area)) return failure("Google sign-in is unavailable until the portal is configured.");
  await clearStaffOAuthCookies();
  const client = await staffClient(true, staffOAuthCookieName);
  if (!client) return failure(unavailable);
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/auth/staff/callback", origin).href,
      scopes: "openid email profile",
      queryParams: { prompt: "select_account" },
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) return failure("Google sign-in could not start. Please try again.");
  (await cookies()).set(staffOAuthAreaCookie, area, {
    httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/", maxAge: 600,
  });
  redirect(data.url);
}

type CodeState = FormState & { email?: string };

export async function requestStaffPasswordCode(area: StaffArea, _previous: CodeState, form: FormData): Promise<CodeState> {
  const email = emailField(form);
  if (!email) return failure("Enter a valid email address.");
  const service = staffService();
  const client = staffAuthAttempt();
  if (!service || !client || !isStaffArea(area)) return failure(unavailable);
  if (await invited(service, area, email) &&
    await allowAttempt(service, "staff-code-cooldown", email, 1, 60) &&
    await allowAttempt(service, "staff-code-hour", email, 5, 3600)) {
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) console.error("Staff password code delivery failed", error.code);
  }
  return { message: "If this email has access, a password setup code will arrive shortly.", email };
}

export async function saveStaffPassword(area: StaffArea, _previous: FormState, form: FormData): Promise<FormState> {
  const email = emailField(form);
  const token = field(form, "code");
  const password = form.get("password");
  if (!email || !/^\d{6,10}$/.test(token)) return failure("Enter your email and the numeric code from the email.");
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return failure("Choose a password with at least 12 characters and no more than 72 UTF-8 bytes.");
  }
  if (password !== form.get("confirm_password")) return failure("The passwords do not match.");
  const service = staffService();
  const client = staffAuthAttempt();
  if (!service || !client || !isStaffArea(area)) return failure(unavailable);
  if (!await invited(service, area, email) || !await allowAttempt(service, "staff-verify", email, 8, 900)) {
    return failure(invalidCode);
  }
  const { data, error } = await client.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user || !data.session) return failure(invalidCode);
  if (!await invitedUser(service, area, data.user, email)) {
    await client.auth.signOut({ scope: "local" });
    return failure(invalidCode);
  }
  const { error: updateError } = await client.auth.updateUser({ password });
  await client.auth.signOut({ scope: updateError ? "local" : "global" });
  if (updateError) return failure("The password could not be set. Choose a different password and request a new code.");
  return { message: "Password saved. You can now sign in with your email and password." };
}

export async function submitVendorApplication(_previous: FormState, form: FormData): Promise<FormState> {
  const accepted = { message: "Application received. Access is granted separately by CampusBite after review." };
  if (field(form, "company_website")) return accepted;
  const email = emailField(form);
  const shop_name = field(form, "shop_name");
  const contact_name = field(form, "contact_name");
  const phone = field(form, "phone");
  const location = field(form, "location");
  const description = field(form, "description");

  if (!email || shop_name.length < 2 || shop_name.length > 100 || contact_name.length < 2 || contact_name.length > 100 ||
    location.length < 2 || location.length > 150 || description.length > 1200 ||
    !/^[+\d ().-]{7,24}$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
    return failure("Check your business name, contact details, and campus location.");
  }

  const service = staffService();
  if (!service) return failure(unavailable);
  if (!await allowAttempt(service, "application-global", "all", 60, 60) ||
    !await allowAttempt(service, "application-email", email, 3, 3600)) return failure("Applications are limited. Please try again later.");
  const { error } = await service.from("vendor_applications").insert({ email, shop_name, contact_name, phone, location, description });
  return error ? failure("Your application could not be saved. Please try again.") : accepted;
}

export async function createVendorShop(_previous: FormState, form: FormData): Promise<FormState> {
  const session = await adminSession(true);
  if (!session) return failure("Administrator access is required.");
  const name = field(form, "name");
  if (name.length < 2 || name.length > 100) return failure("Enter a shop name of 2 to 100 characters.");
  const { error } = await session.client.from("vendor_shops").insert({ name });
  if (error) return failure(error.code === "23505" ? "A shop with that name already exists." : "The shop could not be created.");
  revalidatePath("/admin/access");
  return { message: "Shop created. Select it below to assign access." };
}

export async function saveVendorAccess(_previous: FormState, form: FormData): Promise<FormState> {
  const session = await adminSession(true);
  if (!session) return failure("Administrator access is required.");
  const shop = field(form, "shop_id");
  const email = emailField(form);
  const role = field(form, "role");
  if (!uuid(shop) || !email || !Object.hasOwn(vendorRoles, role)) return failure("Select a shop, enter a valid email, and choose a role.");
  const { error } = await session.client.rpc("campusbite_grant_vendor_access", {
    p_shop_id: shop, p_email: email, p_role: role as VendorRole,
  });
  if (error) return failure("Access could not be saved. Check that the selected shop still exists.");
  revalidatePath("/admin/access");
  return { message: `Access saved. Ask ${email} to sign in at /vendor/sign-in with this email.` };
}

export async function revokeVendorAccess(_previous: FormState, form: FormData): Promise<FormState> {
  const session = await adminSession(true);
  if (!session) return failure("Administrator access is required.");
  const shop = field(form, "shop_id");
  const email = emailField(form);
  if (!uuid(shop) || !email) return failure("The shop or email is invalid.");
  const { error } = await session.client.from("vendor_access").delete().eq("shop_id", shop).eq("email", email);
  if (error) return failure("Access could not be revoked.");
  revalidatePath("/admin/access");
  return { message: "Vendor access revoked." };
}

export async function reviewVendorApplication(_previous: FormState, form: FormData): Promise<FormState> {
  const session = await adminSession(true);
  if (!session) return failure("Administrator access is required.");
  const id = field(form, "id");
  if (!uuid(id)) return failure("The application is invalid.");
  const { error } = await session.client.from("vendor_applications").update({ status: "reviewed" }).eq("id", id);
  if (error) return failure("The application could not be updated.");
  revalidatePath("/admin/applications");
  return { message: "Application marked reviewed." };
}

export async function staffSignOut() {
  const client = await staffClient(true);
  try {
    if (client) await client.auth.signOut({ scope: "local" });
  } catch {
    console.error("Could not reach the staff authentication provider during sign-out");
  } finally {
    await clearStaffCookies();
    await clearStaffOAuthCookies();
  }
  redirect("/vendor");
}
