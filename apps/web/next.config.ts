import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@nexpress/admin",
    "@nexpress/editor",
    "@nexpress/blocks",
    "@nexpress/theme",
    "@nexpress/plugin-sdk",
  ],
  serverExternalPackages: [
    "@nexpress/core",
    "@node-rs/argon2",
    "pg",
    "pg-boss",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push("@node-rs/argon2", "pg-native");
      }
    }
    return config;
  },
};

export default nextConfig;
