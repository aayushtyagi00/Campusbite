import { notFound, redirect } from "next/navigation";
import { OpsShell } from "@/components/ops-shell";
import { AccessManagement, AdminOverview, VendorApplications } from "@/components/staff-admin";
import { StaffSignIn } from "@/components/staff-entry";
import { Notice } from "@/components/ui";
import { adminSession } from "@/lib/staff/access";
import { liveCommerce } from "@/lib/student-auth";
import { StorefrontSettings } from "@/components/storefront-settings";
import { RecentCommerceOrders } from "@/components/recent-commerce-orders";

export default async function Page({ params, searchParams }: {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { screen = [] } = await params;
  const session = await adminSession();
  if (screen.length === 1 && screen[0] === "sign-in") {
    if (session) redirect("/admin");
    return <StaffSignIn area="admin" googleError={(await searchParams).error === "google"} />;
  }
  if (!session) redirect("/admin/sign-in");
  if (screen.length > 1) notFound();
  const section = screen[0];
  if (section === "vendors") redirect("/admin/applications");
  if (["overview", "refunds", "finance", "settings"].includes(section)) redirect("/admin");
  const { client, email } = session;

  if (section === "orders") {
    if (!liveCommerce()) redirect("/admin");
    const [shops, storefronts] = await Promise.all([
      client.from("vendor_shops").select("id,name,created_at").order("name"),
      client.from("commerce_stalls").select("slug,shop_id,capacity,enabled"),
    ]);
    return <OpsShell area="admin" path="/admin/orders" email={email}>
      <h1>Commerce operations</h1>
      {shops.error || storefronts.error ? <Notice>Storefront settings are temporarily unavailable.</Notice> :
        <StorefrontSettings shops={shops.data} storefronts={storefronts.data} />}
      <RecentCommerceOrders />
    </OpsShell>;
  }
  if (section === "access") {
    const [shops, grants] = await Promise.all([
      client.from("vendor_shops").select("id,name,created_at").order("name"),
      client.from("vendor_access").select("shop_id,email,role,created_at").order("email"),
    ]);
    return <OpsShell area="admin" path="/admin/access" email={email}>
      {shops.error || grants.error ? <Notice>Access records are temporarily unavailable.</Notice> :
        <AccessManagement shops={shops.data} grants={grants.data} />}
    </OpsShell>;
  }
  if (section === "applications") {
    const applications = await client.from("vendor_applications").select("*").order("created_at", { ascending: false });
    return <OpsShell area="admin" path="/admin/applications" email={email}>
      {applications.error ? <Notice>Vendor applications are temporarily unavailable.</Notice> :
        <VendorApplications applications={applications.data} />}
    </OpsShell>;
  }
  if (section !== undefined) notFound();
  const [shops, applications] = await Promise.all([
    client.from("vendor_shops").select("id", { count: "exact", head: true }),
    client.from("vendor_applications").select("id", { count: "exact", head: true }).eq("status", "submitted"),
  ]);
  return <OpsShell area="admin" path="/admin" email={email}>
    {shops.error || applications.error ? <Notice>Admin data is temporarily unavailable.</Notice> :
      <AdminOverview shops={shops.count ?? 0} applications={applications.count ?? 0} />}
  </OpsShell>;
}
