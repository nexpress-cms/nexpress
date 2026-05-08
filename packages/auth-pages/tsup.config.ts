import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

// Multi-entry tsup: server (no banner) + client ("use client" banner).
// `clean: true` is intentionally OFF on both — when set on either,
// the racing entry's emit can land BEFORE the clean step on the
// other and lose its dts. The package's `build` script does
// `rm -rf dist` once before invoking tsup so both entries see a
// clean slate without racing.
export default defineConfig([
  {
    entry: { server: "src/server/index.ts" },
    format: ["esm"],
    dts: !fast,
    clean: false,
    sourcemap: !fast,
    external: ["next", "@nexpress/core", "@nexpress/next", "drizzle-orm"],
  },
  {
    entry: { client: "src/client/index.ts" },
    format: ["esm"],
    dts: !fast,
    clean: false,
    sourcemap: !fast,
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
    external: ["react", "react-dom", "next", "@nexpress/core", "@nexpress/next"],
  },
]);
