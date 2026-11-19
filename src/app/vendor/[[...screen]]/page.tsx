import Link from "next/link";
import { ShopMembers } from "@/components/shop-members";
import { StaffForm } from "@/components/staff-forms";
import { editTeamMember } from "@/lib/staff/actions";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { OpsShell } from "@/components/ops-shell";
import { StaffSignIn, VendorHome } from "@/components/staff-entry";
import { ShopDashboard } from "@/components/staff-vendor";
import { Notice } from "@/components/ui";
import { vendorMemberships } from "@/lib/staff/access";
import { staffSession } from "@/lib/staff/supabase";
import { liveCommerce } from "@/lib/student-auth";
import { VendorMenu } from "@/components/vendor-menu";

export default async function Page({ params, searchParams }: {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<{ shop?: string | string[]; members?: string; error?: string | string[] }>;
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

  const { shop: requested, members } = await searchParams;
  const grant = requested === undefined ? memberships.data[0] : memberships.data.find(item => item.shop_id === requested);
  if (!grant) notFound();
  const { client, email } = session;
  const live = liveCommerce();
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
  return <OpsShell area="vendor" path="/vendor/dashboard" email={email}>
    <ShopDashboard shop={shop} shops={shops.data} role={grant.role} orders={[...orders.data, ...(recent?.data ?? [])]} sales={sales?.data} live={live} />
    {grant.role === "owner" && <Suspense key={shop.id + "-team"} fallback={null}>
      <OwnerTeam client={client} shopId={shop.id} members={members} />
    </Suspense>}
    {live && grant.role !== "staff" && <Suspense key={shop.id} fallback={null}>
      <ShopMenu client={client} shopId={shop.id} />
    </Suspense>}
  </OpsShell>;
}

async function ShopMenu({ client, shopId }: {
  client: NonNullable<Awaited<ReturnType<typeof staffSession>>>["client"]; shopId: string;
}) {
  const mapping = await client.from("commerce_stalls").select("slug").eq("shop_id", shopId).maybeSingle();
  if (mapping.error) return <Notice>Menu editing is temporarily unavailable.</Notice>;
  if (!mapping.data) return null;
  const menu = await client.from("commerce_menu").select("id,name,price,sold_out").eq("stall_slug", mapping.data.slug).order("name");
  return menu.error ? <Notice>Menu editing is temporarily unavailable.</Notice> : <VendorMenu items={menu.data} />;
}

async function OwnerTeam({ client, shopId, members }: {
  client: NonNullable<Awaited<ReturnType<typeof staffSession>>>["client"]; shopId: string; members?: string;
}) {
  const page = members && /^[1-9]\d{0,6}$/.test(members) ? Number(members) : 1;
  const offset = (page - 1) * 25;
  const grants = await client.from("vendor_access").select("shop_id,email,role,created_at")
    .eq("shop_id", shopId).order("email").range(offset, offset + 25);
  if (grants.error) return <Notice>Shop team is temporarily unavailable.</Notice>;
  const href = `/vendor/dashboard?shop=${shopId}&members=`;
  return <section className="panel panel-pad stack staff-records">
    <h2>Shop team</h2>
    <StaffForm action={editTeamMember.bind(null, "vendor", "add")} label="Add team member">
      <input name="shop_id" type="hidden" value={shopId} />
      <div className="form-grid">
        <label className="field">Team member email<input name="email" type="email" required maxLength={254} /></label>
        <label className="field">Role<select name="role"><option value="staff">Staff</option><option value="manager">Manager</option></select></label>
      </div>
    </StaffForm>
    <ShopMembers area="vendor" shopId={shopId} grants={grants.data.slice(0, 25)} />
    {(page > 1 || grants.data.length > 25) && <nav className="row" aria-label="Team pages">
      {page > 1 && <Link href={href + (page - 1)}>Previous</Link>}
      <span>Page {page}</span>
      {grants.data.length > 25 && <Link href={href + (page + 1)}>Next</Link>}
    </nav>}
  </section>;
}
