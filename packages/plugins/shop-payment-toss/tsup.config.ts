import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";
const external = [
  "@nexpress/plugin-shop",
  "@nexpress/shop-payment-toss/client",
  "react",
  "react/jsx-runtime",
];

export default defineConfig([
  {
    entry: { index: "src/index.tsx" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    external,
  },
  {
    entry: { client: "src/client.tsx" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
    external,
  },
]);
