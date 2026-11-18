import { StudentShell } from "@/components/student-shell";
import { Installable } from "@/components/installable";
import { liveCommerce } from "@/lib/student-auth";
import { liveStorefronts } from "@/lib/commerce";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const storefronts = liveCommerce() ? await liveStorefronts() : undefined;
  return <StudentShell storefronts={storefronts}><Installable />{children}</StudentShell>;
}
