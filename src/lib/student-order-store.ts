import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";
import type { StudentOrder, StudentOrderHistory } from "./student-order-types";

const cookieName = "campusbite-student-preview";
const sessionSeconds = 86400;
type OrderSession = { expiresAt: number; orders: StudentOrder[] };
const directory = () => process.env.CAMPUSBITE_STUDENT_PREVIEW_DIR || join(process.cwd(), ".data", "student-orders");
const pending = new Map<string, Promise<unknown>>();

async function sessionFile() {
  const token = (await cookies()).get(cookieName)?.value ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return join(directory(), createHash("sha256").update(token).digest("hex") + ".json");
}

async function readSession(file: string): Promise<OrderSession | null> {
  try {
    const session = JSON.parse(await readFile(file, "utf8")) as OrderSession;
    return session.expiresAt > Date.now() ? session : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function serialize<T>(file: string, task: () => Promise<T>) {
  const previous = pending.get(file) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  pending.set(file, current);
  return current.finally(() => {
    if (pending.get(file) === current) pending.delete(file);
  });
}

async function writeSession(file: string, session: OrderSession) {
  const draft = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(draft, JSON.stringify(session), { flag: "wx", mode: 0o600 });
    await rename(draft, file);
  } finally {
    await rm(draft, { force: true });
  }
}

export async function closeStudentOrderSession() {
  const file = await sessionFile();
  if (file) await serialize(file, () => rm(file, { force: true }));
  (await cookies()).delete(cookieName);
}

export async function openStudentOrderSession() {
  const previous = await sessionFile();
  const token = randomBytes(32).toString("hex");
  const file = join(directory(), createHash("sha256").update(token).digest("hex") + ".json");
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify({ expiresAt: Date.now() + sessionSeconds * 1000, orders: [] }), { flag: "wx", mode: 0o600 });
  try {
    if (previous) await serialize(previous, () => rm(previous, { force: true }));
    (await cookies()).set(cookieName, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: sessionSeconds,
    });
  } catch (error) {
    await rm(file, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function studentOrderHistory(): Promise<StudentOrderHistory> {
  try {
    const file = await sessionFile();
    const session = file ? await readSession(file) : null;
    return { signedIn: Boolean(session), orders: session?.orders ?? [] };
  } catch {
    return { signedIn: false, orders: [], unavailable: true };
  }
}

export async function editStudentOrders<T>(edit: (orders: StudentOrder[]) => { orders?: StudentOrder[]; result: T }): Promise<T | null> {
  const file = await sessionFile();
  if (!file) return null;
  return serialize(file, async () => {
    const session = await readSession(file);
    if (!session) return null;
    const { orders, result } = edit(session.orders);
    if (orders) await writeSession(file, { ...session, orders });
    return result;
  });
}
