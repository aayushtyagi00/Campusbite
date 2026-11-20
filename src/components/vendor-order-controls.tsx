"use client";

import { useState } from "react";
import { fulfillOrder } from "@/lib/vendor-fulfillment";
import { Notice } from "./ui";

const actions = { awaiting:["Accept","accepted"], accepted:["Start preparing","preparing"], preparing:["Mark ready","ready"], ready:["Confirm pickup","collected"] } as const;

export function VendorOrderControls({id,status,disabled,refresh}: {id:string;status:string;disabled:boolean;refresh:()=>Promise<void>}) {
  const [code,setCode] = useState("");
  const [reason,setReason] = useState("");
  const [rejecting,setRejecting] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const action = actions[status as keyof typeof actions];
  if (!action) return null;
  async function change(next:string) {
    setBusy(true);
    try {
      const result = await fulfillOrder(id,next,code,reason);
      setMessage(result.error ?? "");
      await refresh();
    } catch { setMessage("Could not confirm the update. Refresh to check the order."); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    {status==="ready" && <label className="field">Pickup code<input value={code} autoComplete="off" inputMode="numeric" maxLength={6} onChange={e=>setCode(e.target.value)} /></label>}
    {rejecting && <label className="field">Reason for the student<textarea value={reason} maxLength={300} onChange={e=>setReason(e.target.value)} required /></label>}
    <div className="row vendor-actions">
      {rejecting ? <>
        <button className="button compact" disabled={busy || disabled || !reason.trim()} onClick={()=>change("rejected")}>Confirm rejection</button>
        <button className="button compact secondary" disabled={busy} onClick={()=>setRejecting(false)}>Back</button></> : <>
        <button className="button compact" disabled={busy || disabled || (status==="ready" && !/^\d{6}$/.test(code))} onClick={()=>change(action[1])}>{action[0]}</button>
        {status==="awaiting" && <button className="button compact secondary" disabled={disabled || busy} onClick={()=>setRejecting(true)}>Reject</button>}</>}
    </div>{message && <Notice>{message}</Notice>}
  </div>;
}
