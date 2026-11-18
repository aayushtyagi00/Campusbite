import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CampusBite | LPU food pickup",
    short_name: "CampusBite",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f7f0",
    theme_color: "#064535",
    icons: [
      { src: "/icons/campusbite-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/campusbite-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/campusbite-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
