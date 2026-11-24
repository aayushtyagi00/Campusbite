"use server";

import { revalidatePath } from "next/cache";
import { adminSession } from "./staff/access";
import { orderUuid } from "./commerce";

export async function reviewCase(id: string, revision: number, _state: {message:string}, form: FormData) {
  const admin = await adminSession(true);
  if (!admin || !orderUuid.test(id)) return {message:"Administrator access required.",error:true};
  const result = await admin.client.rpc("review_order_case",{target:id,version:revision,state:String(form.get("state")),
    reply:String(form.get("reply") ?? ""),request_refund:form.get("refund")==="on"});
  if (result.error || !result.data) return {message:"Review the latest case and refund status before saving.",error:true};
  revalidatePath("/admin","layout");
  revalidatePath("/orders");
  return {message:"Case updated."};
}

export async function changeOrderingPause(paused: boolean) {
  const admin = await adminSession(true);
  if (!admin) throw new Error("Administrator access required.");
  const result = await admin.client.rpc("set_ordering_pause",{value:paused});
  if (result.error) throw new Error("Could not change ordering availability.");
  revalidatePath("/admin/orders");
}
