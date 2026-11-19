import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OpsShell } from "@/components/ops-shell";
import { AccessManagement } from "@/components/access-management";
import { AdminOverview, VendorApplications } from "@/components/staff-admin";
import { StaffSignIn } from "@/components/staff-entry";
import { Notice } from "@/components/ui";
import { adminSession } from "@/lib/staff/access";
import { liveCommerce } from "@/lib/student-auth";
import { CurrentVendors, VendorRecord, ApplicationReview } from "@/components/current-vendors";
import { RecentCommerceOrders } from "@/components/recent-commerce-orders";

const pageSize = 25;

function pageNumber(value: string | string[] | undefined) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n < 10000000 ? n : 1;
}

function PageLinks({ page, more, href, label }: { page: number; more: boolean; href: string; label: string }) {
  if (page === 1 && !more) return null;
  return <nav className="row" aria-label={label}>
    {page > 1 && <Link href={href + (page - 1)}>Previous</Link>}
    <span>Page {page}</span>
    {more && <Link href={href + (page + 1)}>Next</Link>}
  </nav>;
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { screen = [] } = await params;
  const session = await adminSession();
  if (screen.length === 1 && screen[0] === "sign-in") {
    if (session) redirect("/admin");
    return <StaffSignIn area="admin" googleError={(await searchParams).error === "google"} />;
  }
  if (!session) redirect("/admin/sign-in");
  if (screen.length > 2 || (screen.length === 2 && !["vendors","applications"].includes(screen[0]))) notFound();
  const section = screen[0];

  if (["overview", "refunds", "finance", "settings"].includes(section)) redirect("/admin");
  const { client, email } = session;

  if (section === "vendors" || (section === "applications" && screen[1])) {
    return <OpsShell area="admin" path={"/admin/"+section} email={email}>
      {section === "applications" ? <ApplicationReview client={client} id={screen[1]} /> :
        screen[1] ? <VendorRecord client={client} id={screen[1]} /> : <CurrentVendors client={client} page={pageNumber((await searchParams).page)} />}
    </OpsShell>;
  }
  if (section === "orders") {
    if (!liveCommerce()) redirect("/admin");
    return <OpsShell area="admin" path="/admin/orders" email={email}>
      <h1>Commerce operations</h1>
      <Link className="text-link" href="/admin/vendors">Manage storefronts and pickup capacity</Link>
      <RecentCommerceOrders />
    </OpsShell>;
  }
  if (section === "access") {
    const query = await searchParams;
    const page = pageNumber(query.page);
    const offset = (page - 1) * pageSize;
    const members = pageNumber(query.members);
    const start = (members - 1) * pageSize;
    const requestedShop = typeof query.shop === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(query.shop)
      ? query.shop : undefined;
    const membersOf = (id: string) => client.from("vendor_access").select("shop_id,email,role,created_at")
      .eq("shop_id", id).order("email").range(start, start + pageSize);
    const [shops, shop, grants] = await Promise.all([
      client.from("vendor_shops").select("id,name,created_at").order("name").order("id").range(offset, offset + pageSize),
      requestedShop ? client.from("vendor_shops").select("id,name,created_at").eq("id", requestedShop).maybeSingle() : null,
      requestedShop ? membersOf(requestedShop) : null,
    ]);
    const visible = shops.data?.slice(0, pageSize) ?? [];
    const selected = shop?.data ?? undefined;
    return <OpsShell area="admin" path="/admin/access" email={email}>
      {shops.error || shop?.error || grants?.error ? <Notice>Access records are temporarily unavailable.</Notice> : <>
        <AccessManagement shops={visible} selected={selected} page={page} grants={grants?.data?.slice(0, pageSize) ?? []}
          shopPages={<PageLinks page={page} more={(shops.data?.length ?? 0) > pageSize} href="/admin/access?page=" label="Shop pages" />} />
        {selected && <PageLinks page={members} more={(grants?.data?.length ?? 0) > pageSize}
          href={`/admin/access?page=${page}&shop=${selected.id}&members=`} label="Member pages" />}
      </>}
    </OpsShell>;
  }
  if (section === "applications") {
    const page = pageNumber((await searchParams).page);
    const start = (page - 1) * pageSize;
    const applications = await client.from("vendor_applications").select("*").neq("status","draft")
      .order("created_at", { ascending: false }).order("id").range(start, start + pageSize);
    return <OpsShell area="admin" path="/admin/applications" email={email}>
      {applications.error ? <Notice>Vendor applications are temporarily unavailable.</Notice> :
        <><VendorApplications applications={applications.data.slice(0, pageSize)} />
          <PageLinks page={page} more={applications.data.length > pageSize} href="/admin/applications?page=" label="Application pages" /></>}
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
