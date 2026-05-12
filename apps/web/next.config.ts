import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@nexpress/admin",
    // `@nexpress/app` ships its page implementations as raw .tsx
    // for both apps/web and scaffolded sites to re-export. Listed
    // here so Next compiles those pages with this project's
    // tsconfig — that's what makes the `@/lib/init-core` import
    // resolve to the consumer's actual file at the package's edge.
    "@nexpress/app",
    "@nexpress/editor",
    "@nexpress/blocks",
    "@nexpress/theme",
    "@nexpress/theme-default",
    "@nexpress/theme-magazine",
    "@nexpress/theme-portfolio",
    "@nexpress/plugin-sdk",
    "@nexpress/plugin-reading-time",
  ],
  // Next 16 made Turbopack the default bundler. The previous
  // `webpack` callback just pushed Node-native bindings to
  // `externals`; `serverExternalPackages` already does that for
  // both bundlers, so the callback is redundant. `pg-native` is
  // listed alongside `pg` because it's an optional native binding
  // pg pulls in dynamically — Turbopack would otherwise try to
  // bundle it.
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
