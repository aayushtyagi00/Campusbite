"use server";

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { clearDeviceAlerts } from "./push-device";
import { adminSession } from "./staff/access";
import { staffSession } from "./staff/supabase";
import { studentIdentity } from "./student-auth";
import { commerceDb, orderUuid } from "./commerce";

export async function registerPush(audience:"student"|"vendor"|"admin", shop:string|undefined, subscription:PushSubscriptionJSON) {
  if (!process.env.VAPID_PRIVATE_KEY || !subscription?.endpoint || subscription.endpoint.length>2500) return false;
  const url = new URL(subscription.endpoint);
  const allowed = ["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com","notify.windows.com"];
  if (url.protocol!=="https:" || url.port || url.username || url.password ||
      !allowed.some(host=>url.hostname===host || url.hostname.endsWith("."+host))) return false;
  if (!/^[A-Za-z0-9_-]{87}$/.test(subscription.keys?.p256dh ?? "") || !/^[A-Za-z0-9_-]{22}$/.test(subscription.keys?.auth ?? "")) return false;
  let order_alerts=true, refund_alerts=true;
  let student_id=null, email=null, shop_id=null;
  if (audience==="student") {
    const user=await studentIdentity();
    if (!user) return false;
    student_id=user.id;
    order_alerts=user.profile.orderAlerts; refund_alerts=user.profile.refundAlerts;
  } else if (audience==="admin") {
    const user=await adminSession();
    if (!user) return false;
    email=user.email;
  } else if (audience==="vendor" && shop && orderUuid.test(shop)) {
    const user=await staffSession();
    if (!user) return false;
    const {data}=await user.client.from("vendor_access").select("shop_id").eq("shop_id",shop).eq("email",user.email).maybeSingle();
    if (!data) return false;
    email=user.email; shop_id=shop;
  } else return false;
  const token=randomUUID();
  const {error}=await commerceDb().from("push_subscriptions").upsert({endpoint:url.href,revoke_token:token,keys:subscription.keys,
    student_id,email,shop_id,audience,order_alerts,refund_alerts,updated_at:new Date().toISOString()});
  if (error) return false;
  (await cookies()).set("campusbite-alerts-"+(audience==="student"?"student":"staff"),token,{
    httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:31536000,
  });
  return true;
}

export async function disablePush(portal:"student"|"staff") {
  if (portal==="student" || portal==="staff") await clearDeviceAlerts(portal);
}
