"use server";

import { redirect } from "next/navigation";
import { invited } from "./staff/access";
import { staffService, staffSession } from "./staff/supabase";

type State={message:string;factor?:string;secret?:string};

async function administrator() {
  const session=await staffSession(true);
  const service=staffService();
  return session && service && await invited(service,"admin",session.email) ? session : null;
}

export async function beginAdminMfa():Promise<State> {
  const admin=await administrator();
  if (!admin) return {message:"Sign in with your administrator account."};
  const mfa=admin.client.auth.mfa;
  const factors=await mfa.listFactors();
  if (factors.error) return {message:"Could not load your authenticator."};
  const existing=factors.data.totp[0];
  if (existing) return {message:"Enter the code from your authenticator.",factor:existing.id};
  const enrolled=await mfa.enroll({factorType:"totp",issuer:"CampusBite"});
  if (enrolled.error) return {message:"Could not start enrollment. Check that TOTP is enabled in Supabase."};
  return {message:"Add this setup key to your authenticator, then enter its six-digit code.",factor:enrolled.data.id,secret:enrolled.data.totp.secret};
}

export async function verifyAdminMfa(factor:string,code:string) {
  const admin=await administrator();
  if (!admin || !/^[0-9]{6}$/.test(code)) return "Enter a six-digit authenticator code.";
  const result=await admin.client.auth.mfa.challengeAndVerify({factorId:factor,code});
  if (result.error) return "Verification failed. Enter the current code.";
  redirect("/admin");
}
