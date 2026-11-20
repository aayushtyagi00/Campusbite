import { writeMenuItem } from "@/lib/vendor-fulfillment";
import type { CommerceMenuRow } from "@/lib/staff/database";
import { money } from "@/lib/campus";
import { StaffForm } from "./staff-forms";
import { Photo, Status } from "./ui";

function ItemForm({shop, item}: {shop:string; item?:CommerceMenuRow}) {
  return <StaffForm action={writeMenuItem.bind(null,shop,item?.id ?? null,item?.revision ?? -1)} label={item ? "Save item" : "Create item"}>
    <div className="form-grid">
      <label className="field">Item name<input name="name" defaultValue={item?.name} maxLength={100} required /></label>
      <label className="field">Category<select name="category" defaultValue={item?.category}>{["Meals","Wraps","Drinks","Snacks"].map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="field">Price (₹)<input name="price" type="number" min="1" max="10000" step=".01" defaultValue={item && item.price/100} required /></label>
      <label className="field">Preparation time (minutes)<input name="prep" type="number" min="1" max="50" defaultValue={item?.prep} required /></label>
      <label className="field">Dietary label<input name="diet" maxLength={80} defaultValue={item?.diet} required /></label>
      <label className="field">Availability<select name="status" defaultValue={item?.archived ? "archived" : item?.sold_out ? "sold_out" : "available"}>
        <option value="available">Available</option><option value="sold_out">Sold out</option><option value="archived">Archived</option></select></label>
    </div>
    <label className="field">Description and allergens<textarea name="description" maxLength={500} defaultValue={item?.description} required /></label>
    <input type="hidden" name="photo" value={item?.photo ?? ""} />
    <label className="field">Item photo (optional, up to 3 MB)<input name="upload" type="file" accept="image/jpeg,image/png,image/webp" /></label>
  </StaffForm>;
}
export function VendorMenu({shop, items}: {shop:string; items:CommerceMenuRow[]}) {
  return <div className="stack"><details className="panel panel-pad ops-details" open={!items.length}>
    <summary><strong>Add a menu item</strong></summary><ItemForm shop={shop} /></details>
    {items.map(item=><details className="panel panel-pad ops-details" key={item.id}>
      <summary><Photo name={item.photo} className="vendor-thumb" /><strong>{item.name}</strong><span>{money(item.price)}</span>
        <Status>{item.archived ? "Archived" : item.sold_out ? "Sold out" : "Available"}</Status></summary>
      <ItemForm key={item.revision} shop={shop} item={item} /></details>)}</div>;
}
