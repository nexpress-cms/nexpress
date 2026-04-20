import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      server: "src/server.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ["react", "react-dom", "lexical", /^@lexical\//],
  },
  {
    entry: {
      client: "src/client.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: ["react", "react-dom", "lexical", /^@lexical\//],
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
  },
]);
