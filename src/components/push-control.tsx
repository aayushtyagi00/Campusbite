"use client";
import { useState } from "react";
import { registerPush, disablePush } from "@/lib/push-actions";

export function PushControl({audience,shop}:{audience:"student"|"vendor"|"admin";shop?:string}) {
  const [message,setMessage]=useState("");
  const key=process.env.NEXT_PUBLIC_VAPID_KEY;
  if (!key) return null;
  async function subscribe() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser does not support push.");
      if (await Notification.requestPermission()!=="granted") throw new Error("Allow notifications in browser settings to receive alerts.");
      await navigator.serviceWorker.register("/sw.js");
      const registration=await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      if (!await registerPush(audience,shop,subscription.toJSON())) throw new Error("Could not save this device for alerts.");
      setMessage("Device alerts enabled. Manage notification permission in browser settings.");
    } catch(error) {setMessage(error instanceof Error?error.message:"Could not enable notifications.");}
  }
  async function disable() {
    try {
      await disablePush(audience==="student" ? "student" : "staff");
      setMessage("Device alerts disabled for this account.");
    } catch {setMessage("Could not disable device alerts. Please retry.");}
  }
  return <div><button type="button" className="button secondary" onClick={subscribe}>Enable device alerts</button> <button type="button" className="text-link" onClick={disable}>Disable alerts</button>{message && <p role="status">{message}</p>}</div>;
}
