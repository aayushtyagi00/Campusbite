import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { VendorOnboarding } from "@/components/vendor-onboarding";
import { ShopMembers } from "@/components/shop-members";
import { StaffForm } from "@/components/staff-forms";
import { editTeamMember } from "@/lib/staff/actions";
import { OpsShell } from "@/components/ops-shell";
import { StaffSignIn, VendorHome } from "@/components/staff-entry";
import { OrderBoard } from "@/components/staff-vendor";
import { Notice, Status } from "@/components/ui";
import { vendorMemberships } from "@/lib/staff/access";
import { vendorRoles } from "@/lib/staff/database";
import { vendorSession } from "@/lib/staff/vendor-session";
import { liveCommerce } from "@/lib/student-auth";
import { orderUuid } from "@/lib/commerce";
import { categories } from "@/lib/campus";
import { VendorMenu } from "@/components/vendor-menu";
import { Availability, VendorEarnings, WorkspaceOnboarding } from "@/components/vendor-settings";

const sections = {board:"Order board",orders:"Order details",menu:"Menu editor",availability:"Availability",onboarding:"Onboarding",earnings:"Earnings"} as const;
type Client = NonNullable<Awaited<ReturnType<typeof vendorSession>>>["client"];

export default async function Page({ params, searchParams }: {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<{shop?:string;members?:string;name?:string;error?:string;period?:string;page?:string}>;
}) {
  const {screen=[]} = await params;
  const query = await searchParams;
  if (!screen.length) return <VendorHome />;
  if (screen[0]==="onboarding" && screen.length<=2 && (!query.shop || screen.length===2)) return <VendorOnboarding id={screen[1]} name={query.name} />;
  const session = await vendorSession();
  if (screen.length===1 && screen[0]==="sign-in") {
    if (session && (await vendorMemberships(session)).data?.length) redirect("/vendor/board");
    return <StaffSignIn area="vendor" googleError={query.error==="google"} />;
  }
  if (!session) redirect("/vendor/sign-in");
  const memberships = await vendorMemberships(session);
  if (memberships.error) return <Notice>Shop access could not be loaded.</Notice>;
  if (!memberships.data.length) redirect("/vendor/sign-in");
  const grant = query.shop===undefined ? memberships.data[0] : memberships.data.find(row=>row.shop_id===query.shop);
  if (!grant) notFound();
  const shop = grant.shop_id;
  if (screen.length===1 && screen[0]==="dashboard") redirect((query.members && grant.role==="owner" ? "/vendor/onboarding?shop="+shop+"&members="+encodeURIComponent(query.members) : "/vendor/board?shop="+shop));
  const section = screen[0] as keyof typeof sections;
  if (!Object.hasOwn(sections,section) || (section==="orders" ? screen.length!==2 || !orderUuid.test(screen[1]) : screen.length!==1)) notFound();
  const isBoard = section==="orders" || section==="board";
  if (!isBoard && grant.role==="staff") notFound();
  const shops = await session.client.from("vendor_shops").select("id,name").in("id",memberships.data.map(row=>row.shop_id)).order("name");
  const current = shops.data?.find(row=>row.id===shop);
  if (shops.error) return <Notice>Shop information could not be loaded.</Notice>;
  if (!current) notFound();
  const nav = isBoard ? "board" : section;
  return <OpsShell area="vendor" path={"/vendor/"+nav} email={session.email} shop={shop} staffOnly={grant.role==="staff"}>
    <header className="ops-heading"><div><p className="eyebrow">{current.name}</p><h1>{sections[section]}</h1></div><Status>{vendorRoles[grant.role]}</Status></header>
    {shops.data.length>1 && <nav className="chips staff-records" aria-label="Your shops">{shops.data.map(row=>{
      const destination = memberships.data.find(g=>g.shop_id===row.id)?.role==="staff" ? "board" : nav;
      return <Link className={"button compact"+(row.id===shop?"":" secondary")} key={row.id} href={"/vendor/"+destination+"?shop="+row.id}>{row.name}</Link>;
    })}</nav>}
    {isBoard ? <BoardPage key={shop+section+screen[1]} client={session.client} shop={shop} selected={screen[1]} /> :
      section==="earnings" ? <VendorEarnings client={session.client} shop={shop} period={query.period} page={query.page}/> :
      <ShopSettings client={session.client} shop={shop} section={section} />}
    {section==="onboarding" && grant.role==="owner" && <OwnerTeam client={session.client} shopId={shop} members={query.members} />}
  </OpsShell>;
}

async function BoardPage({client,shop,selected}:{client:Client;shop:string;selected?:string}) {
  const result = await client.rpc("vendor_order_feed",{target_shop:shop,selected_order:selected});
  if (selected && !result.error && !result.data?.length) notFound();
  return <OrderBoard key={shop+(selected ?? "")} shop={shop} selected={selected} initial={result.error ? null : result.data} serverTime={Date.now()} live={liveCommerce()} />;
}

async function ShopSettings({client,shop,section}:{client:Client;shop:string;section:string}) {
  const store = await client.from("commerce_stalls").select("*").eq("shop_id",shop).maybeSingle();
  if (store.error) return <Notice>Storefront settings could not be loaded.</Notice>;
  if (section==="onboarding") return <WorkspaceOnboarding client={client} shop={shop} store={store.data} />;
  if (!store.data) return <Notice>Your storefront setup is pending. <Link href={"/vendor/onboarding?shop="+shop}>View onboarding</Link>.</Notice>;
  if (section==="availability") return <Availability shop={shop} store={store.data} />;
  const menu = await client.from("commerce_menu").select("*").eq("stall_slug",store.data.slug).order("archived").order("name");
  return menu.error ? <Notice>Menu editing is temporarily unavailable.</Notice> : <VendorMenu options={store.data.menu_categories ?? categories} shop={shop} items={menu.data} />;
}

async function OwnerTeam({ client, shopId, members }: {
  client: NonNullable<Awaited<ReturnType<typeof vendorSession>>>["client"]; shopId: string; members?: string;
}) {
  const page = members && /^[1-9]\d{0,6}$/.test(members) ? Number(members) : 1;
  const offset = (page - 1) * 25;
  const grants = await client.from("vendor_access").select("shop_id,email,role,created_at")
    .eq("shop_id", shopId).order("email").range(offset, offset + 25);
  if (grants.error) return <Notice>Shop team is temporarily unavailable.</Notice>;
  const href = `/vendor/onboarding?shop=${shopId}&members=`;
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
