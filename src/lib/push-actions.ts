"use server";

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { clearDeviceAlerts } from "./push-device";
import { adminSession, allowAttempt } from "./staff/access";
import { staffService } from "./staff/supabase";
import { vendorSession } from "./staff/vendor-session";
import { studentIdentity } from "./student-auth";
import { commerceDb, orderUuid } from "./commerce";

export async function registerPush(audience:"student"|"vendor"|"admin", shop:string|undefined, subscription:PushSubscriptionJSON) {
  if (!process.env.VAPID_PRIVATE_KEY || typeof subscription?.endpoint !== "string" || subscription.endpoint.length>2500 ||
    !URL.canParse(subscription.endpoint)) return false;
  const url = new URL(subscription.endpoint);
  const allowed = ["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com","notify.windows.com"];
  if (url.protocol!=="https:" || url.port || url.username || url.password ||
      !allowed.some(host=>url.hostname===host || url.hostname.endsWith("."+host))) return false;
  const p256dh = subscription.keys?.p256dh, auth = subscription.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" ||
      !/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) return false;
  let order_alerts=true, refund_alerts=true;
  let student_id=null, email=null, shop_id=null, staff_session_id=null;
  if (audience==="student") {
    const user=await studentIdentity();
    if (!user) return false;
    student_id=user.id;
    order_alerts=user.profile.orderAlerts; refund_alerts=user.profile.refundAlerts;
  } else if (audience==="admin" || audience==="vendor") {
    const user=audience==="admin" ? await adminSession() : await vendorSession();
    if (!user) return false;
    const {data,error}=await user.client.auth.getClaims();
    if (error || !data?.claims.session_id) return false;
    staff_session_id=data.claims.session_id;
    email=user.email;
    if (audience==="vendor") {
      if (!shop || !orderUuid.test(shop)) return false;
      const grant=await user.client.from("vendor_access").select("shop_id").eq("shop_id",shop).eq("email",user.email).maybeSingle();
      if (!grant.data) return false;
      shop_id=shop;
    }
  } else return false;
  const service = staffService();
  if (!service || !await allowAttempt(service, "push-registration", student_id ?? email!, 12, 3600)) return false;
  const token=randomUUID();
  const {error}=await commerceDb().from("push_subscriptions").upsert({endpoint:url.href,revoke_token:token,keys:{auth,p256dh},
    student_id,email,shop_id,staff_session_id,audience,order_alerts,refund_alerts,updated_at:new Date().toISOString()});
  if (error) return false;
  (await cookies()).set("campusbite-alerts-"+(audience==="student"?"student":"staff"),token,{
    httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:31536000,
  });
  return true;
}

export async function disablePush(portal:"student"|"staff") {
  if (portal==="student" || portal==="staff") await clearDeviceAlerts(portal);
}
