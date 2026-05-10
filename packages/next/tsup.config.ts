import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

const externals = [
  "next",
  "next/headers",
  "next/navigation",
  "next/link",
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@nexpress/core",
];

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: !fast,
    clean: true,
    sourcemap: !fast,
    external: externals,
  },
  {
    entry: { client: "src/client.ts" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
    external: externals,
  },
]);
