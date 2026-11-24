"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, RefreshCw } from "lucide-react";
import { clockTime, dateLabel, money, slotLabel, statuses } from "@/lib/campus";
import type { BoardOrder } from "@/lib/staff/database";
import { VendorOrderControls } from "./vendor-order-controls";
import { Notice, Status } from "./ui";

const queues = [["awaiting","Awaiting acceptance"],["accepted","Accepted / scheduled"],["preparing","Preparing"],["ready","Ready for pickup"],["closed","Completed and closed"]] as const;
const active = new Set<string>(queues.slice(0,4).map(([status])=>status));
const deadline = (order:BoardOrder) => order.accept_until ? Date.parse(order.accept_until) : 0;

function sound(context:AudioContext) {
  const tone = context.createOscillator(), volume = context.createGain();
  tone.connect(volume); volume.connect(context.destination);
  tone.frequency.setValueAtTime(660,context.currentTime);
  tone.frequency.setValueAtTime(880,context.currentTime+.13);
  volume.gain.setValueAtTime(.12,context.currentTime);
  volume.gain.exponentialRampToValueAtTime(.001,context.currentTime+.42);
  tone.start(); tone.stop(context.currentTime+.43);
}

export function OrderBoard({shop,selected,initial,serverTime,live}: {shop:string;selected?:string;initial:BoardOrder[]|null;serverTime:number;live:boolean}) {
  const [orders,setOrders] = useState(initial ?? []);
  const [last,setLast] = useState(initial ? serverTime : 0);
  const [now,setNow] = useState(serverTime);
  const [connected,setConnected] = useState(initial!==null);
  const [subscribed,setSubscribed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [accessLost,setAccessLost] = useState(false);
  const [alerts,setAlerts] = useState(false);
  const [audioError,setAudioError] = useState("");
  const audio = useRef<AudioContext|null>(null);
  const seen = useRef(new Set(initial?.filter(o=>o.status==="awaiting").map(o=>o.id)));
  const clockOffset = useRef(0);
  const request = useRef<AbortController|null>(null);
  const path = "/api/vendor/shops/"+shop;
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const timeout = setTimeout(()=>controller.abort("timeout"),8000);
    try {
      const response = await fetch(path+"/orders"+(selected ? "?order="+selected : ""),{cache:"no-store",signal:controller.signal});
      if (!response.ok) {
        if ([401,403].includes(response.status)) { setAccessLost(true); setOrders([]); }
        throw new Error("Feed unavailable");
      }
      const data: {orders:BoardOrder[];serverTime:number} = await response.json();
      if (request.current !== controller) return;
      const incoming = data.orders.filter(o=>o.status==="awaiting" && deadline(o)>data.serverTime).map(o=>o.id);
      if (audio.current?.state==="running" && incoming.some(id=>!seen.current.has(id))) sound(audio.current);
      seen.current = new Set(incoming);
      clockOffset.current = data.serverTime-Date.now();
      setNow(data.serverTime); setLast(data.serverTime); setOrders(data.orders); setConnected(true); setAccessLost(false);
    } catch {
      if (request.current===controller && (!controller.signal.aborted || controller.signal.reason==="timeout")) setConnected(false);
    } finally {
      clearTimeout(timeout);
      if (request.current===controller) { request.current=null; setBusy(false); }
    }
  },[path,selected]);

  useEffect(()=>{
    let stream:EventSource|null = null;
    function disconnect() { stream?.close(); stream=null; setSubscribed(false); }
    function sync() {
      if (!navigator.onLine) { disconnect(); setConnected(false); return; }
      if (!document.hidden) void refresh();
      if (!stream && !accessLost) {
        stream = new EventSource(path+"/events");
        stream.onmessage = event=>{
          if (event.data==="connected") setSubscribed(true);
          void refresh();
        };
        stream.onerror = ()=>setSubscribed(false);
      }
    }
    sync();
    const poll = setInterval(()=>{ if (!document.hidden && navigator.onLine && !request.current) void refresh(); },10000);
    const tick = setInterval(()=>setNow(Date.now()+clockOffset.current),500);
    document.addEventListener("visibilitychange",sync);
    window.addEventListener("online",sync); window.addEventListener("offline",sync);
    return ()=>{
      disconnect(); request.current?.abort(); window.clearInterval(poll); window.clearInterval(tick);
      document.removeEventListener("visibilitychange",sync);
      window.removeEventListener("online",sync); window.removeEventListener("offline",sync);
    };
  },[refresh,path,accessLost]);
  useEffect(()=>()=>{ void audio.current?.close(); audio.current=null; },[]);
  async function enableSound() {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      sound(audio.current); setAudioError(""); setAlerts(true);
    } catch { setAudioError("Sound is unavailable on this device. Check the browser’s audio settings."); }
  }

  const card = (order:BoardOrder) => {
    const start = Date.parse(order.pickup_at), seconds = Math.max(0,Math.ceil((deadline(order)-now)/1000));
    return <article className="panel board-card stack" key={order.id}>
      <div className="row between"><strong>{selected ? order.reference : <Link className="text-link" href={"/vendor/orders/"+order.id+"?shop="+shop}>{order.reference}</Link>}</strong>
        {(selected || !active.has(order.status)) && <Status>{statuses[order.status]}</Status>}</div>
      <p><strong>Pickup</strong> · {dateLabel(start)} · {slotLabel({start,end:start+(order.pickup_minutes ?? 10)*60000})} IST</p>
      {order.status==="awaiting" && order.accept_until && <p className={"vendor-deadline"+(seconds<=20 ? " urgent" : "")}>{seconds ? "Accept within "+seconds+"s" : "Acceptance window ended"}</p>}
      {order.prep_minutes !== null && <p>Prep · {order.prep_minutes} min · Start by <strong>{clockTime(start-(order.prep_minutes+(order.buffer_minutes ?? 2))*60000)}</strong></p>}
      <ul>{(order.items ?? []).map((item,i)=><li key={i}>{item.qty} × {item.name}{selected && item.price!=null && " · "+money(item.price*item.qty)}</li>)}</ul>
      {order.status==="ready" && order.holding_until && <p>Hold until {clockTime(Date.parse(order.holding_until))} IST</p>}
      {order.preparation_note && <p className="vendor-note">Student note · {order.preparation_note}</p>}
      {order.rejection_reason && <p>Rejection reason · {order.rejection_reason}</p>}
      {selected && <>{order.amount_paise!=null && <p><strong>Order total · {money(order.amount_paise)}</strong></p>}
        {order.refund && <p>Refund · {order.refund}</p>}</>}
      {live && <VendorOrderControls key={order.status} id={order.id} status={order.status}
        disabled={!connected || (order.status==="awaiting" && seconds===0)} refresh={refresh} />}
      {selected && <section className="stack"><h2>Order activity</h2>{order.events.length ? order.events.map((event,i)=>
        <div className="row between" key={i}><span>{event.status}</span><time>{dateLabel(event.at)} · {clockTime(event.at)} IST</time></div>) : <p>No activity recorded.</p>}</section>}
    </article>;
  };
  return <div className="stack">
    {selected && <Link className="text-link" href={"/vendor/board?shop="+shop}>← Order board</Link>}
    <div className="panel vendor-toolbar">
      <div><Status tone={connected ? "good" : "warn"}>{accessLost ? "Access ended" : connected ? subscribed ? "Live updates" : "Connected · polling" : "Connection lost"}</Status>
        {last>0 && <p className="fineprint">Last synced {clockTime(last)} IST</p>}</div>
      <button className="button secondary compact" disabled={busy} onClick={refresh}><RefreshCw size={16}/>{busy ? "Refreshing…" : "Refresh"}</button>
      {!selected && <><button className="button secondary compact" aria-pressed={alerts} onClick={async ()=>{
        if (!alerts) return enableSound();
        await audio.current?.suspend(); setAlerts(false);
      }}><Bell size={16}/>{alerts ? "Mute order alerts" : "Enable order alerts"}</button>
        {alerts && <button className="text-link" onClick={enableSound}>Test sound</button>}</>}
    </div>
    {audioError && <Notice>{audioError}</Notice>}
    {accessLost ? <Notice>Your shop access has ended. <Link href="/vendor/sign-in">Sign in again</Link>.</Notice> :
      <>{!connected && <Notice>{last ? "Showing the last synced orders. Reconnect to update them." : "Orders could not be loaded. Refresh to retry."}</Notice>}
        {selected ? orders.length ? card(orders[0]) : connected && <Notice>This order could not be found in this shop.</Notice> :
          (last>0 && <div className="vendor-queues">{queues.map(([key,label])=>{
            const rows = orders.filter(o=>key==="closed" ? !active.has(o.status) : o.status===key);
            if (key==="closed") rows.reverse();
            return <section key={key} className={"vendor-queue queue-"+key}><h2>{label} <span>{rows.length}</span></h2>
              {rows.length ? rows.map(card) : <p className="fineprint">No orders</p>}</section>;
          })}</div>)}</>}
  </div>;
}
