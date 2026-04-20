import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@nexpress/core",
    "@nexpress/admin",
    "@nexpress/editor",
    "@nexpress/blocks",
    "@nexpress/theme",
    "@nexpress/plugin-sdk",
  ],
};

export default nextConfig;
