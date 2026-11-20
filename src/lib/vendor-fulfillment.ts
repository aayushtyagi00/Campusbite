"use server";

import { revalidatePath, updateTag } from "next/cache";
import { staffSession, staffService } from "./staff/supabase";
import { orderUuid } from "./commerce";

export async function fulfillOrder(id: string, next: string, code: string, reason = "") {
  if (!orderUuid.test(id) || !["accepted","rejected","preparing","ready","collected"].includes(next)
    || (next === "collected" && !/^\d{6}$/.test(code))) return { error: "Check the pickup code and order action." };
  if (next === "rejected" && (!reason.trim() || reason.trim().length > 300)) return { error: "Enter a reason of up to 300 characters." };
  const session = await staffSession(true);
  if (!session) return { error: "Sign in again to update this order." };
  const result = next === "rejected"
    ? await session.client.rpc("vendor_reject_order", { order_id: id, reason: reason.trim() })
    : await session.client.rpc("commerce_fulfill", { order_id: id, next_status: next, submitted_code: code });
  if (result.error || !result.data) return { error: "The order may have changed. Refresh and check the pickup code or deadline." };
  return {};
}

type FormState = { message: string; error?: boolean };
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const failure = (message: string) => ({ error: true, message });
function refreshCatalog(page: string) {
  updateTag("campusbite-storefronts");
  revalidatePath("/vendor/" + page);
}

export async function saveAvailability(shop: string, revision: number, _: FormState, form: FormData) {
  const session = await staffSession(true);
  if (!session) return failure("Sign in again.");
  const opening = field(form,"opening"), closing = field(form,"closing");
  const slots = Number(field(form,"slots")), basket = Number(field(form,"basket"));
  const closures = [...new Set(field(form,"closures").split(/[,\s]+/).filter(Boolean))];
  if (!/^\d{2}:\d{2}$/.test(opening) || !/^\d{2}:\d{2}$/.test(closing) || opening >= closing ||
    !Number.isInteger(slots) || slots < 1 || slots > 100 || !Number.isInteger(basket) || basket < 1 || basket > 8)
    return failure("Check the opening hours, pickup capacity and basket size.");
  if (closures.length > 90 || closures.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day))
    return failure("Use up to 90 closure dates in YYYY-MM-DD format.");
  const result = await session.client.rpc("vendor_set_availability", { target_shop: shop, expected_revision: revision,
    opening, closing, slots, basket, closures, paused: form.has("paused") });
  if (result.error) return failure("Could not save availability. Reload to check the latest settings and your shop access.");
  refreshCatalog("availability");
  return { message: "Availability saved." };
}

export async function writeMenuItem(shop: string, itemId: string | null, revision: number, _: FormState, form: FormData) {
  const session = await staffSession(true);
  if (!session) return failure("Sign in again.");
  const name = field(form,"name"), description = field(form,"description"), diet = field(form,"diet");
  const priceText = field(form,"price"), price = Math.round(Number(priceText)*100), prep = Number(field(form,"prep"));
  const category = field(form,"category"), status = field(form,"status");
  if (!name || name.length>100 || !description || description.length>500 || !diet || diet.length>80 ||
      !/^\d+(\.\d{1,2})?$/.test(priceText) || price<100 || price>1000000 || !Number.isInteger(prep) || prep<1 || prep>50 ||
      !["Meals","Wraps","Drinks","Snacks"].includes(category) || !["available","sold_out","archived"].includes(status))
    return failure("Check the item details, price and prep time.");
  let photo = field(form,"photo");
  if (photo && !/^[\w-]+$/.test(photo) && !(photo.startsWith("menu:"+shop+"/") && /^[\da-f-]{36}\.(jpg|png|webp)$/.test(photo.split("/")[1]))) return failure("Invalid menu photo.");
  const upload = form.get("upload");
  let uploadedPath: string | undefined;
  const storage = staffService()?.storage.from("menu-photos");
  if (upload instanceof File && upload.size) {
    if (!storage || upload.size>3145728) return failure("Choose a JPG, PNG or WebP image under 3 MB.");
    const access = await session.client.from("vendor_access").select("role").eq("shop_id",shop).eq("email",session.email).maybeSingle();
    if (!access.data || access.data.role === "staff") return failure("Shop management access required.");
    const bytes = Buffer.from(await upload.arrayBuffer());
    const ext = bytes.subarray(0,3).toString("hex")==="ffd8ff" ? "jpg" :
      bytes.subarray(0,8).toString("hex")==="89504e470d0a1a0a" ? "png" :
      bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP" ? "webp" : null;
    if (!ext) return failure("Choose a JPG, PNG or WebP image.");
    uploadedPath = shop+"/"+crypto.randomUUID()+"."+ext;
    const result = await storage.upload(uploadedPath,bytes,{ contentType: "image/"+(ext==="jpg"?"jpeg":ext) });
    if (result.error) return failure("Image upload failed. Please retry.");
    photo = "menu:"+uploadedPath;
  }
  const result = await session.client.rpc("vendor_write_item",{ target_shop:shop,item_id:itemId ?? crypto.randomUUID(),
    expected_revision:revision,fields:{name,category,description,price,prep,diet,photo,archived:status==="archived",sold_out:status!=="available"} });
  if (result.error) {
    if (uploadedPath && result.status >= 400 && result.status < 500) await storage?.remove([uploadedPath]);
    return failure("Could not save the item. Reload to check the latest item and your shop access.");
  }
  refreshCatalog("menu");
  return {message:"Menu item saved."};
}
