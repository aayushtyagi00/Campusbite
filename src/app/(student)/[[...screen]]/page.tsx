import { notFound, redirect } from "next/navigation";
import { StudentPage } from "@/components/student";
import { StudentHelp } from "@/components/student-help";
import { studentOrderHistory } from "@/lib/student-order-store";
import { liveStudent, studentIdentity } from "@/lib/student-auth";
import { liveOrderHistory } from "@/lib/commerce";
import { LiveStudentAccount } from "@/components/live-student-account";

const routes = new Set(["court", "order-online", "about", "bag", "checkout", "sign-in", "recovery", "orders", "account"]);
const helpRoutes = ["support", "privacy-policy", "pickup-refunds"] as const;
const detail = new Set(["stalls", "products"]);

export default async function Page({ params, searchParams }: {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { screen = [] } = await params;
  if (screen[0] === "orders" && (screen.length !== 1 || Object.keys(await searchParams).length)) redirect("/orders");
  const help = helpRoutes.find(route => screen.length === 1 && screen[0] === route);
  if (help) return <StudentHelp section={help} live={liveStudent()} />;
  if (screen.length > 2 || (screen.length === 1 && !routes.has(screen[0])) || (screen.length === 2 && !detail.has(screen[0]))) notFound();
  if (liveStudent() && ["sign-in", "recovery", "account"].includes(screen[0])) {
    const query = await searchParams;
    const actor = screen[0] === "account" ? await studentIdentity() : null;
    return <LiveStudentAccount key={screen[0]} section={screen[0]} email={actor?.email}
      returnTo={query.returnTo === "checkout" ? "checkout" : undefined} googleError={query.error === "google"} />;
  }
  const history = screen[0] === "orders" || screen[0] === "checkout"
    ? liveStudent() ? await liveOrderHistory(screen[0] === "orders") : await studentOrderHistory()
    : undefined;
  return <StudentPage section={screen[0] ?? "home"} id={screen[1]} history={history} />;
}
