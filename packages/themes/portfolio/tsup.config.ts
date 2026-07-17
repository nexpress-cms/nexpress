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
      "@nexpress/blocks",
      "@nexpress/theme",
      "./components/mobile-nav.js",
      "./components/error.js",
      "./components/members-error.js",
      "./components/local-time-ticker.js",
    ],
  },
  {
    entry: {
      "components/mobile-nav": "src/components/mobile-nav.tsx",
      "components/error": "src/components/error.tsx",
      "components/members-error": "src/components/members-error.tsx",
      "components/local-time-ticker": "src/components/local-time-ticker.tsx",
    },
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    external: ["react", "react-dom", "next", "next/link", "@nexpress/blocks", "@nexpress/theme"],
    banner: { js: '"use client";' },
  },
]);
