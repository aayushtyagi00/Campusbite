"use client";

import { useEffect } from "react";

export function Installable() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Browsing works when this browser blocks service workers.
      });
    }
  }, []);
  return null;
}
