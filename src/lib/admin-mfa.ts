"use server";

import { redirect } from "next/navigation";
import { allowAttempt, ownerSession } from "./staff/access";
import { staffService } from "./staff/supabase";

type State={message:string;factor?:string;secret?:string};

export async function beginAdminMfa():Promise<State> {
  const admin=await ownerSession(true);
  if (!admin) return {message:"Sign in with your administrator account."};
  const mfa=admin.client.auth.mfa;
  const factors=await mfa.listFactors();
  if (factors.error) return {message:"Could not load your authenticator."};
  const existing=factors.data.totp[0];
  if (existing) return {message:"Enter the code from your authenticator.",factor:existing.id};
  const service=staffService();
  if (!service || !await allowAttempt(service,"admin-totp-enroll",admin.email,5,900))
    return {message:"Authenticator setup is temporarily unavailable. Try again later."};
  const enrolled=await mfa.enroll({factorType:"totp",issuer:"CampusBite"});
  if (enrolled.error) return {message:"Could not start enrollment. Check that TOTP is enabled in Supabase."};
  return {message:"Add this setup key to your authenticator, then enter its six-digit code.",factor:enrolled.data.id,secret:enrolled.data.totp.secret};
}

export async function verifyAdminMfa(factor:string,code:string) {
  const admin=await ownerSession(true);
  if (!admin) return "Sign in with your administrator account.";
  if (typeof factor!=="string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(factor) ||
      typeof code!=="string" || !/^[0-9]{6}$/.test(code)) return "Enter a six-digit authenticator code.";
  const service=staffService();
  if (!service || !await allowAttempt(service,"admin-totp-verify",admin.email,8,900))
    return "Verification is temporarily unavailable. Try again later.";
  const result=await admin.client.auth.mfa.challengeAndVerify({factorId:factor,code});
  if (result.error) return "Verification failed. Enter the current code.";
  redirect("/admin");
}
