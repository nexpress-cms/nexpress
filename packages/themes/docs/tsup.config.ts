import { defineConfig } from "tsup";

export default defineConfig([
  {
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
      "./components/members-error.js",
    ],
  },
  {
    entry: {
      "components/members-error": "src/components/members-error.tsx",
    },
    format: ["esm"],
    dts: true,
    clean: false,
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
    banner: { js: '"use client";' },
  },
]);
