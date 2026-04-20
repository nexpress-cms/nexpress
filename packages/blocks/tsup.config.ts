import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    external: [
      "react",
      "react-dom",
      "@nexpress/core",
      "@nexpress/editor",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
    ],
  },
  {
    entry: {
      client: "src/client.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: [
      "react",
      "react-dom",
      "@nexpress/core",
      "@nexpress/editor",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
    ],
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
  },
]);
