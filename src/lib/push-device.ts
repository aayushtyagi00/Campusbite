import "server-only";
import { cookies } from "next/headers";
import { commerceDb, orderUuid } from "./commerce";

export async function clearDeviceAlerts(portal:"staff"|"student") {
  const jar=await cookies();
  const cookie="campusbite-alerts-"+portal;
  const token=jar.get(cookie)?.value;
  if (!token || !orderUuid.test(token)) return;
  const {error}=await commerceDb().from("push_subscriptions").delete().eq("revoke_token",token);
  if (error) throw new Error("Could not remove this device subscription.");
  jar.delete(cookie);
}
