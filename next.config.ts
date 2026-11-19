import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default config;
