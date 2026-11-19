import { ClipboardList, Gauge, LayoutGrid, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import { NavigationHint } from "./navigation-hint";
import { staffSignOut } from "@/lib/staff/actions";
import { liveCommerce } from "@/lib/student-auth";
import { Brand } from "./ui";

const links = {
  vendor: [
    ["/vendor/dashboard", "Shop dashboard", LayoutGrid],
  ],
  admin: [
    ["/admin", "Overview", Gauge], ["/admin/applications", "Vendor applications", ClipboardList],
    ["/admin/vendors", "Current Vendors", Store], ["/admin/access", "Access Management", ShieldCheck],
  ],
} as const;

export function OpsShell({ area, path, email, children }: { area: keyof typeof links; path: string; email: string; children: React.ReactNode }) {
  return <div className="ops">
    <aside className="ops-sidebar">
      <Brand />
      <span className="eyebrow ops-area">{area === "vendor" ? "Vendor workspace" : "Admin workspace"}</span>
      <nav aria-label={area === "vendor" ? "Vendor navigation" : "Admin navigation"}>
        {links[area].map(([href, label, Icon]) => <Link key={href} href={href} aria-current={path === href ? "page" : undefined}><Icon size={18} />{label}<NavigationHint /></Link>)}
        {area === "admin" && liveCommerce() && <Link href="/admin/orders" aria-current={path === "/admin/orders" ? "page" : undefined}>
          <LayoutGrid size={18} /> Commerce operations
        <NavigationHint /></Link>}
      </nav>
      <Link className="text-link ops-return" href={area === "vendor" ? "/vendor" : "/"}>{area === "vendor" ? "Vendor homepage" : "Student website"}<NavigationHint /></Link>
      <form action={staffSignOut} className="ops-sign-out"><button className="button secondary compact">Sign out</button></form>
    </aside>
    <main className="ops-main" id="main">
      <div className="staff-identity"><ShieldCheck size={17} aria-hidden="true" /><span>{email}</span></div>
      {children}
    </main>
  </div>;
}
