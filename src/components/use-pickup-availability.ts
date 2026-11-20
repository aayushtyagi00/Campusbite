"use client";

import { useEffect, useState } from "react";
import type { PickupSlot } from "@/lib/campus";

type Quote = { slots: PickupSlot[]; message?: string };
type Snapshot = Quote & {key:string; received:number};

export function usePickupAvailability(query: string | null, refresh: number) {
  const [snapshot,setSnapshot] = useState<Snapshot>();
  useEffect(()=>{
    if (!query) return;
    let active = true;
    let controller: AbortController | undefined;
    async function load() {
      if (document.hidden || !active || controller) return;
      controller = new AbortController();
      const timeout = setTimeout(()=>controller?.abort(),8000);
      try {
        const result = await fetch("/api/pickup-availability",{method:"POST",headers:{"Content-Type":"application/json"},
          body:query,cache:"no-store",signal:controller.signal});
        if (!result.ok) throw new Error("Availability unavailable");
        const quote:Quote = await result.json();
        if (active) setSnapshot({...quote,key:query!,received:Date.now()});
      } catch {
        if (active) setSnapshot({key:query!,received:Date.now(),slots:[],message:"Could not check pickup availability. Refresh to try again."});
      } finally { clearTimeout(timeout); controller=undefined; }
    }
    void load();
    const timer = window.setInterval(load,10000);
    document.addEventListener("visibilitychange",load);
    window.addEventListener("online",load);
    return ()=>{
      active=false; controller?.abort(); clearInterval(timer);
      document.removeEventListener("visibilitychange",load);
      window.removeEventListener("online",load);
    };
  },[query,refresh]);
  return snapshot?.key===query ? snapshot : undefined;
}
