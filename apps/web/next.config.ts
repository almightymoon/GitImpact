import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@gitimpact/analysis",
    "@gitimpact/shared",
    "@gitimpact/git",
    "@gitimpact/parser",
    "@gitimpact/graph",
    "@gitimpact/impact-engine",
    "@gitimpact/framework-detector",
    "@gitimpact/db",
    "@gitimpact/ops",
  ],
  serverExternalPackages: ["ts-morph", "postgres", "bullmq", "ioredis"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
