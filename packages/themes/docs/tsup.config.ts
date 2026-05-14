import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    // `clean: true` here races with the parallel dts build of
    // the second entry block — the index dts can start its
    // resolve pass before the client-component .d.ts files land
    // and then cache the "missing module" result. Clean is
    // moved into the npm script (`rm -rf dist && tsup`).
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
      "./components/error.js",
      "./components/members-error.js",
      "./components/search-keyboard-shortcut.js",
      "./components/toc-scrollspy.js",
    ],
  },
  {
    entry: {
      "components/error": "src/components/error.tsx",
      "components/members-error": "src/components/members-error.tsx",
      "components/search-keyboard-shortcut":
        "src/components/search-keyboard-shortcut.tsx",
      "components/toc-scrollspy": "src/components/toc-scrollspy.tsx",
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
