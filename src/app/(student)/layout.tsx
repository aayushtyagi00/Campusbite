import { StudentShell } from "@/components/student-shell";
import { Installable } from "@/components/installable";
import { liveCommerce } from "@/lib/student-auth";
import { campusCourts, liveStorefronts } from "@/lib/commerce";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const [storefronts,courts] = await Promise.all([liveStorefronts(),campusCourts()]);
  return <StudentShell storefronts={{ ...storefronts, courts, live: liveCommerce() }}><Installable />{children}</StudentShell>;
}
