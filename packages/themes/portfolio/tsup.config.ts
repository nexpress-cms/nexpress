import { cp } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    // Clean once in the build script; per-entry cleanup can delete the
    // parallel client entry's declaration files before packing.
    clean: false,
    sourcemap: true,
    onSuccess: async () => {
      await cp(
        new URL("./src/fonts/", import.meta.url),
        new URL("./dist/fonts/", import.meta.url),
        {
          recursive: true,
        },
      );
    },
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
