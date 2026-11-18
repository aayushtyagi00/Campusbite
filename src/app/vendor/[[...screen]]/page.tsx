import { notFound, redirect } from "next/navigation";
import { OpsShell } from "@/components/ops-shell";
import { StaffSignIn, VendorHome } from "@/components/staff-entry";
import { ShopDashboard } from "@/components/staff-vendor";
import { Notice } from "@/components/ui";
import { vendorMemberships } from "@/lib/staff/access";
import { staffSession } from "@/lib/staff/supabase";
import { liveStudent } from "@/lib/student-auth";
import { VendorMenu } from "@/components/vendor-menu";

export default async function Page({ params, searchParams }: {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<{ shop?: string | string[]; error?: string | string[] }>;
}) {
  const { screen = [] } = await params;
  if (screen.length === 0) return <VendorHome />;
  if (screen.length === 1 && screen[0] === "sign-in") {
    const session = await staffSession();
    if (session && (await vendorMemberships(session)).data?.length) redirect("/vendor/dashboard");
    return <StaffSignIn area="vendor" googleError={(await searchParams).error === "google"} />;
  }

  const session = await staffSession();
  if (!session) redirect("/vendor/sign-in");
  const memberships = await vendorMemberships(session);
  if (!memberships.data?.length) redirect("/vendor/sign-in");
  if (screen.length !== 1) notFound();
  if (["board", "menu", "availability", "onboarding", "earnings"].includes(screen[0])) redirect("/vendor/dashboard");
  if (screen[0] !== "dashboard") notFound();

  const requested = (await searchParams).shop;
  const grant = requested === undefined ? memberships.data[0] : memberships.data.find(item => item.shop_id === requested);
  if (!grant) notFound();
  const { client, email } = session;
  const live = liveStudent();
  const orderQuery = live
    ? client.from("vendor_orders").select("id,shop_id,reference,status,pickup_at,items,preparation_note")
    : client.from("vendor_orders").select("id,shop_id,reference,status,pickup_at");
  const active = ["awaiting", "accepted", "preparing", "ready"] as const;
  const [shops, orders, sales, recent] = await Promise.all([
    client.from("vendor_shops").select("id,name,created_at").in("id", memberships.data.map(item => item.shop_id)).order("name"),
    live ? orderQuery.eq("shop_id", grant.shop_id).in("status", active).order("pickup_at").limit(250) :
      orderQuery.eq("shop_id", grant.shop_id).order("pickup_at", { ascending: false }).limit(50),
    grant.role === "staff" ? null : client.from("vendor_sales").select("id,shop_id,reference,amount_paise,recorded_at").eq("shop_id", grant.shop_id).order("recorded_at", { ascending: false }).limit(50),
    live ? client.from("vendor_orders").select("id,shop_id,reference,status,pickup_at").eq("shop_id", grant.shop_id)
      .in("status", ["collected", "cancelled", "expired", "rejected"]).order("pickup_at", { ascending: false }).limit(20) : null,
  ]);
  if (shops.error || orders.error || sales?.error || recent?.error) {
    return <OpsShell area="vendor" path="/vendor/dashboard" email={email}><Notice>Shop data is temporarily unavailable.</Notice></OpsShell>;
  }
  const shop = shops.data.find(item => item.id === grant.shop_id);
  if (!shop) notFound();
  const mapping = live && grant.role !== "staff" ? await client.from("commerce_stalls")
    .select("slug").eq("shop_id", shop.id).maybeSingle() : null;
  const menu = mapping?.data ? await client.from("commerce_menu")
    .select("id,name,price,sold_out").eq("stall_slug", mapping.data.slug).order("name") : null;
  return <OpsShell area="vendor" path="/vendor/dashboard" email={email}>
    <ShopDashboard shop={shop} shops={shops.data} role={grant.role} orders={[...orders.data, ...(recent?.data ?? [])]} sales={sales?.data} live={live} />
    {mapping?.error || menu?.error ? <Notice>Menu editing is temporarily unavailable.</Notice> :
      menu?.data && <VendorMenu items={menu.data} />}
  </OpsShell>;
}
