import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@gitimpact/analysis",
    "@gitimpact/shared",
    "@gitimpact/git",
    "@gitimpact/parser",
    "@gitimpact/graph",
    "@gitimpact/impact-engine",
  ],
  serverExternalPackages: ["ts-morph"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
