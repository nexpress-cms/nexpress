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
      "@nexpress/editor",
      "@nexpress/theme",
      "./components/mobile-nav.js",
      "./components/newsletter-form.js",
      "./components/error.js",
      "./components/members-error.js",
    ],
  },
  {
    entry: {
      "components/mobile-nav": "src/components/mobile-nav.tsx",
      "components/newsletter-form": "src/components/newsletter-form.tsx",
      "components/error": "src/components/error.tsx",
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
      "@nexpress/editor",
      "@nexpress/theme",
    ],
    banner: { js: '"use client";' },
  },
]);
