import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@nexpress/admin",
    "@nexpress/app",
    "@nexpress/auth-pages",
    "@nexpress/editor",
    "@nexpress/blocks",
    "@nexpress/theme",
    "@nexpress/next",
    "@nexpress/plugin-sdk",
  ],
  // Next 16 made Turbopack the default bundler. Mixing a `webpack`
  // callback with no Turbopack config trips
  //   "this build is using turbopack, with a webpack config and no
  //    turbopack config"
  // and stops `pnpm dev`. The previous callback only pushed
  // Node-native bindings into `externals`, which `serverExternalPackages`
  // already covers for both bundlers. `pg-native` is listed alongside
  // `pg` because it's an optional native binding pg pulls in
  // dynamically — without it Turbopack tries to bundle it.
  serverExternalPackages: [
    "@nexpress/core",
    "@node-rs/argon2",
    "pg",
    "pg-native",
    "pg-boss",
    "sharp",
  ],
};

export default nextConfig;
