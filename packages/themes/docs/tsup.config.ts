import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    "react",
    "react-dom",
    "next",
    "next/link",
    "next/headers",
    "@nexpress/blocks",
    "@nexpress/core",
    "@nexpress/editor",
    "@nexpress/next",
    "@nexpress/theme",
  ],
});
