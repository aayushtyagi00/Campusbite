import { StudentShell } from "@/components/student-shell";
import { Installable } from "@/components/installable";
import { liveStudent } from "@/lib/student-auth";
import { liveStorefronts } from "@/lib/commerce";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const storefronts = liveStudent() ? await liveStorefronts() : undefined;
  return <StudentShell storefronts={storefronts}><Installable />{children}</StudentShell>;
}
