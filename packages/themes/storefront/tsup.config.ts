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
    "@nexpress/blocks",
    "@nexpress/core",
    "@nexpress/core/fields",
    "@nexpress/core/media",
    "@nexpress/core/navigation",
    "@nexpress/editor",
    "@nexpress/editor/server",
    "@nexpress/next",
    "@nexpress/theme",
  ],
});
