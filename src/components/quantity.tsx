"use client";

import { Minus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { isOrderable, type Product } from "@/lib/campus";
import { setQuantity, usePreview, usePreviewReady } from "@/lib/preview";
import { Status } from "./ui";

export function Quantity({ product }: { product: Product }) {
  const data = usePreview();
  const ready = usePreviewReady();
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const count = data.cart.find(item => item.id === product.id)?.qty ?? 0;
  const stall = data.stalls.find(item => item.id === product.stall);
  const unavailable = product.soldOut || product.archived || data.orderingPaused || !stall || !isOrderable(stall);

  function change(qty: number, replace = false) {
    const result = setQuantity(product, qty, replace);
    if (result === "different-stall") {
      dialog.current?.showModal();
      return;
    }
    dialog.current?.close();
    setError(result ?? "");
  }

  return <div className="quantity">
    {!count ? unavailable ? <Status tone="warn">{product.soldOut ? "Sold out" : "Unavailable"}</Status> :
      <button className="button compact secondary" disabled={!ready} onClick={() => change(1)} aria-label={`Add ${product.name}`}><Plus size={15} /> Add</button> :
      <div className="stepper"><button onClick={() => change(count - 1)} aria-label={`Remove one ${product.name}`}><Minus size={16} /></button><output>{count}</output><button disabled={Boolean(unavailable)} onClick={() => change(count + 1)} aria-label={`Add one ${product.name}`}><Plus size={16} /></button></div>}
    {error && <small className="error" role="status">{error}</small>}
    <dialog className="panel dialog" ref={dialog} aria-label="Replace your bag?">
      <h2>Replace your bag?</h2><p>You can order from one stall at a time. Start a new bag with {product.name}?</p>
      <div className="row wrap-row"><button className="button secondary" onClick={() => dialog.current?.close()}>Keep bag</button><button className="button" onClick={() => change(1, true)}>Replace bag</button></div>
    </dialog>
  </div>;
}
