import { StudentShell } from "@/components/student-shell";
import { Installable } from "@/components/installable";
import { liveCommerce } from "@/lib/student-auth";
import { liveStorefronts } from "@/lib/commerce";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const storefronts = await liveStorefronts();
  return <StudentShell storefronts={{ ...storefronts, live: liveCommerce() }}><Installable />{children}</StudentShell>;
}
