import { notFound, redirect } from "next/navigation";
import { StudentPage } from "@/components/student";
import { StudentHelp } from "@/components/student-help";
import { studentAccount, studentSettings } from "@/lib/student-auth";
import { StudentRecovery } from "@/components/student-recovery";
import { recoveryGrant } from "@/lib/student-recovery";
import { orderUuid } from "@/lib/commerce";
import { liveOrderHistory } from "@/lib/commerce";
import { LiveStudentAccount } from "@/components/live-student-account";

const routes = new Set(["court", "order-online", "about", "bag", "checkout", "sign-in", "recovery", "orders", "account"]);
const helpRoutes = ["support", "privacy-policy", "terms-of-service", "pickup-refunds"] as const;
const detail = new Set(["stalls", "products"]);

export default async function Page({ params, searchParams }: {
  params: Promise<{ screen?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { screen = [] } = await params;
  if (screen[0] === "orders" && (screen.length !== 1 || Object.keys(await searchParams).length)) redirect("/orders");
  const help = helpRoutes.find(route => screen.length === 1 && screen[0] === route);
  if (help) return <StudentHelp section={help} />;
  if (screen[0] === "recovery" && (screen.length === 1 || (screen.length === 2 && orderUuid.test(screen[1])))) {
    if (!studentSettings()) return <div className="narrow"><h1>Student recovery is temporarily unavailable</h1></div>;
    return <StudentRecovery key={screen[1] ?? "recovery"} linkAttempt={screen[1]} grantAttempt={(await recoveryGrant())?.attempt}
      siteKey={process.env.TURNSTILE_SITE_KEY} />;
  }
  if (screen.length > 2 || (screen.length === 1 && !routes.has(screen[0])) || (screen.length === 2 && !detail.has(screen[0]))) notFound();
  if (["sign-in", "account"].includes(screen[0])) {
    if (!studentSettings()) return <div className="narrow"><h1>Student accounts are temporarily unavailable</h1>
      <p>Please try again once student sign-in has been configured.</p></div>;
    const query = await searchParams;
    const actor = screen[0] === "account" ? await studentAccount() : null;
    return <LiveStudentAccount key={screen[0]} section={screen[0]} email={actor?.email} profile={actor?.profile}
      returnTo={query.returnTo === "checkout" ? "checkout" : undefined} googleError={query.error === "google"} />;
  }
  const history = screen[0] === "orders" || screen[0] === "checkout"
    ? await liveOrderHistory(screen[0] === "orders")
    : undefined;
  return <StudentPage section={screen[0] ?? "home"} id={screen[1]} history={history} />;
}
