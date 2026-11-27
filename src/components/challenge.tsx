"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { Notice } from "./ui";

type Widget = {
  render(container: HTMLElement, options: object): string;
  remove(id: string): void;
};
export function Challenge({ siteKey, action, onToken }: { siteKey: string; action: string; onToken?: (value: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const api = (window as Window & { turnstile?: Widget }).turnstile;
    if (!ready || !api || !element.current) return;
    const id = api.render(element.current, { sitekey: siteKey, action, callback: onToken,
      "expired-callback": () => onToken?.(""), "error-callback": () => { onToken?.(""); setFailed(true); } });
    return () => api.remove(id);
  }, [action, onToken, ready, siteKey]);
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)} onError={() => setFailed(true)} />
    <div ref={element} />{failed && <Notice>Verification could not load. Refresh the page and try again.</Notice>}</>;
}
