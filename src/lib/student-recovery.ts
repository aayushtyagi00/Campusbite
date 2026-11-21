import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const cookieName = "campusbite-recovery";
type Grant = { attempt: string; proof: string; expires: number };

export function recoveryHash(kind: string, value: string) {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Student recovery is unavailable");
  return createHmac("sha256", secret).update("student-recovery/" + kind + "/" + value).digest("hex");
}

const cookieKey = () => Buffer.from(recoveryHash("encryption", "v1"), "hex");
const options = { httpOnly: true, sameSite: "strict" as const, path: "/recovery",
  secure: process.env.NODE_ENV === "production" };

export function sealRecoveryValue(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(bytes => bytes.toString("base64url")).join(".");
}

export function openRecoveryValue(value: string) {
  const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", cookieKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString();
}

export async function saveRecoveryGrant(grant: Grant) {
  (await cookies()).set(cookieName, sealRecoveryValue(JSON.stringify(grant)), { ...options, maxAge: 600 });
}

export async function recoveryGrant(): Promise<Grant | null> {
  const value = (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  try {
    const grant: Grant = JSON.parse(openRecoveryValue(value));
    return grant.expires > Date.now() ? grant : null;
  } catch { return null; }
}

export async function clearRecoveryGrant() {
  (await cookies()).set(cookieName, "", { ...options, maxAge: 0 });
}
