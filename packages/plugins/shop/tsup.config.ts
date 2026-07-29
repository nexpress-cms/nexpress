import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: [
    "next",
    "next/link",
    "next/navigation",
    "react",
    "react/jsx-runtime",
    "react-dom",
    "@nexpress/core",
    "@nexpress/core/collections",
    "@nexpress/core/fields",
    "@nexpress/core/i18n",
    "@nexpress/core/media",
    "@nexpress/editor",
    "@nexpress/editor/server",
    "@nexpress/next",
    "@nexpress/plugin-sdk",
  ],
});
