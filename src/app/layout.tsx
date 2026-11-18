import type { Metadata, Viewport } from "next";
import "@fontsource-variable/dm-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CampusBite | LPU food pickup", template: "%s | CampusBite" },
  description: "Order ahead from UniMall stalls and pick up fresh food between classes.",
};
export const viewport: Viewport = { themeColor: "#f8f7f0" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-IN"><body><a href="#main" className="skip">Skip to content</a>{children}</body></html>;
}
