import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig([
  {
    entry: { server: "src/server/index.ts" },
    format: ["esm"],
    dts: !fast,
    clean: true,
    sourcemap: !fast,
    external: ["next", "@nexpress/core", "@nexpress/next", "drizzle-orm"],
  },
  {
    entry: { client: "src/client/index.ts" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
    external: ["react", "react-dom", "next", "@nexpress/core", "@nexpress/next"],
  },
]);
