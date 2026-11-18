import { notFound, redirect } from "next/navigation";
import { OpsShell } from "@/components/ops-shell";
import { StaffSignIn, VendorHome } from "@/components/staff-entry";
import { ShopDashboard } from "@/components/staff-vendor";
import { Notice } from "@/components/ui";
import { vendorMemberships } from "@/lib/staff/access";
import { staffSession } from "@/lib/staff/supabase";

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
  const [shops, orders, sales] = await Promise.all([
    client.from("vendor_shops").select("id,name,created_at").in("id", memberships.data.map(item => item.shop_id)).order("name"),
    client.from("vendor_orders").select("id,shop_id,reference,status,pickup_at").eq("shop_id", grant.shop_id).order("pickup_at", { ascending: false }).limit(50),
    grant.role === "staff" ? null : client.from("vendor_sales").select("id,shop_id,reference,amount_paise,recorded_at").eq("shop_id", grant.shop_id).order("recorded_at", { ascending: false }).limit(50),
  ]);
  if (shops.error || orders.error || sales?.error) {
    return <OpsShell area="vendor" path="/vendor/dashboard" email={email}><Notice>Shop data is temporarily unavailable.</Notice></OpsShell>;
  }
  const shop = shops.data.find(item => item.id === grant.shop_id);
  if (!shop) notFound();
  return <OpsShell area="vendor" path="/vendor/dashboard" email={email}>
    <ShopDashboard shop={shop} shops={shops.data} role={grant.role} orders={orders.data} sales={sales?.data} />
  </OpsShell>;
}
