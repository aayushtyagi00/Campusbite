"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fulfillOrder } from "@/lib/vendor-fulfillment";
import { Notice } from "./ui";

const actions: Record<string, { label: string; next: string }[]> = {
  awaiting: [{ label: "Accept", next: "accepted" }, { label: "Reject", next: "rejected" }],
  accepted: [{ label: "Start preparing", next: "preparing" }],
  preparing: [{ label: "Mark ready", next: "ready" }],
  ready: [{ label: "Confirm pickup", next: "collected" }],
};

export function VendorBoardRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) router.refresh(); }, 8000 + Math.random() * 4000);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}

export function VendorOrderControls({ id, status }: { id: string; status: string }) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  if (!actions[status]) return null;
  return <div className="stack">
    {status === "ready" && <label className="field">Pickup code<input value={code} onChange={event => setCode(event.target.value)}
      maxLength={6} inputMode="numeric" /></label>}
    <div className="row">{actions[status].map(action => <button type="button" key={action.next} className="button compact secondary"
      disabled={pending || (status === "ready" && !/^\d{6}$/.test(code))} onClick={async () => {
        setPending(true);
        try {
          const result = await fulfillOrder(id, action.next, code);
          setMessage(result.error ?? "");
          if (!result.error) router.refresh();
        } catch { setMessage("Could not update the order."); }
        finally { setPending(false); }
      }}>{action.label}</button>)}</div>
    {message && <Notice>{message}</Notice>}
  </div>;
}
