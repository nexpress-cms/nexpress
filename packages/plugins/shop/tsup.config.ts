import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

const external = [
  "next",
  "next/link",
  "next/navigation",
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@nexpress/core",
  "@nexpress/core/collections",
  "@nexpress/core/db",
  "@nexpress/core/fields",
  "@nexpress/core/i18n",
  "@nexpress/core/media",
  "@nexpress/core/media-contract",
  "@nexpress/core/community",
  "@nexpress/core/sites",
  "@nexpress/editor",
  "@nexpress/editor/server",
  "@nexpress/next",
  "@nexpress/plugin-sdk",
  "@nexpress/plugin-shop/client",
  "@nexpress/plugin-shop/restock-alert-client",
  "drizzle-orm",
];

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    external,
  },
  {
    entry: {
      client: "src/client.tsx",
      "restock-alert-client": "src/restock-alert-client.tsx",
    },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
    external,
  },
]);
