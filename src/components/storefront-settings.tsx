"use client";

import { useState } from "react";
import { stalls } from "@/lib/campus";
import { saveStorefront } from "@/lib/commerce-admin";
import type { VendorShop } from "@/lib/staff/database";
import { Notice } from "./ui";

type Storefront = { slug: string; shop_id: string; capacity: number; enabled: boolean };

export function StorefrontSettings({ shops, storefronts }: { shops: VendorShop[]; storefronts: Storefront[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return <section className="panel panel-pad stack">
    <h2>Storefronts and pickup capacity</h2>
    <p>Link a storefront to the shop that will prepare its orders. Capacity is the number of orders per ten-minute window.</p>
    {stalls.map(stall => {
      const linked = storefronts.find(item => item.slug === stall.id);
      return <form key={stall.id} className="stack" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        try {
          const result = await saveStorefront(form);
          setMessage(result.error ?? `${stall.name} saved.`);
        } catch { setMessage("Could not save the storefront."); }
        finally { setPending(false); }
      }}>
        <h3>{stall.name}</h3>
        <input type="hidden" name="slug" value={stall.id} />
        <label className="field">Vendor shop<select name="shop" defaultValue={linked?.shop_id ?? ""} required>
          <option value="">Select shop</option>{shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
        </select></label>
        <label className="field">Orders per slot<input type="number" name="capacity" min={1} max={100} required defaultValue={linked?.capacity ?? stall.capacity} /></label>
        <label className="row"><input type="checkbox" name="enabled" defaultChecked={linked?.enabled ?? false} /> Enable paid checkout</label>
        <button className="button compact secondary" disabled={pending}>Save {stall.name}</button>
      </form>;
    })}
    {message && <Notice>{message}</Notice>}
  </section>;
}
