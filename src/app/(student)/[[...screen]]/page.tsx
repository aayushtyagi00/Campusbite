import { notFound } from "next/navigation";
import { StudentPage } from "@/components/student";
import { StudentHelp } from "@/components/student-help";

const routes = new Set(["court", "order-online", "about", "bag", "checkout", "sign-in", "recovery", "orders", "account"]);
const helpRoutes = ["support", "privacy-policy", "pickup-refunds"] as const;
const detail = new Set(["stalls", "products", "orders"]);

export default async function Page({ params }: { params: Promise<{ screen?: string[] }> }) {
  const { screen = [] } = await params;
  const help = helpRoutes.find(route => screen.length === 1 && screen[0] === route);
  if (help) return <StudentHelp section={help} />;
  if (screen.length > 2 || (screen.length === 1 && !routes.has(screen[0])) || (screen.length === 2 && !detail.has(screen[0]))) notFound();
  return <StudentPage section={screen[0] ?? "home"} id={screen[1]} />;
}
