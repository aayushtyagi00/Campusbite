"use client";

import { useState } from "react";
import { saveMenuItem } from "@/lib/vendor-fulfillment";
import { Notice } from "./ui";

type Item = { id: string; name: string; price: number; sold_out: boolean };

export function VendorMenu({ items }: { items: Item[] }) {
  return <section className="panel panel-pad stack staff-records">
    <h2>Menu prices and availability</h2>
    {!items.length && <p>No menu items have been configured for this storefront.</p>}
    {items.map(item => <MenuItem key={item.id} item={item} />)}
  </section>;
}

function MenuItem({ item }: { item: Item }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return <form className="stack" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      const result = await saveMenuItem(item.id, form);
      setMessage(result.error ?? "Menu item updated.");
    } catch { setMessage("Could not update the menu item."); }
    finally { setPending(false); }
  }}>
    <h3>{item.name}</h3>
    <label className="field">Price in rupees<input name="price" type="number" min={1} max={10000} step={0.01}
      defaultValue={(item.price / 100).toFixed(2)} required /></label>
    <label className="row"><input name="soldOut" type="checkbox" defaultChecked={item.sold_out} /> Sold out</label>
    <button className="button compact secondary" disabled={pending}>Save {item.name}</button>
    {message && <Notice>{message}</Notice>}
  </form>;
}
