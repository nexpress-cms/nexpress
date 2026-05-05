import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: !fast,
  clean: true,
  target: "es2022",
  external: ["fast-xml-parser", "node-html-parser", "@nexpress/core"],
});
