import { defineConfig } from "tsup";

const fast = process.env.NX_DEV_FAST === "1";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    dts: !fast,
    clean: true,
    sourcemap: !fast,
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
    dts: !fast,
    sourcemap: !fast,
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
