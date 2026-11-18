import { StudentShell } from "@/components/student-shell";
import { Installable } from "@/components/installable";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <StudentShell><Installable />{children}</StudentShell>;
}
