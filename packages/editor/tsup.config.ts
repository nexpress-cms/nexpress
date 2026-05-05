import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      server: "src/server.ts",
    },
    format: ["esm"],
    dts: !fast,
    clean: true,
    sourcemap: !fast,
    external: ["react", "react-dom", "lexical", /^@lexical\//],
  },
  {
    entry: {
      client: "src/client.ts",
    },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    external: ["react", "react-dom", "lexical", /^@lexical\//],
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
  },
]);
