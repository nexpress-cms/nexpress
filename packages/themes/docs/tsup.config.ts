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
      "./components/error.js",
      "./components/members-error.js",
      "./components/search-keyboard-shortcut.js",
      // doc-page.tsx (at src/templates/) imports TocScrollspy via
      // the package subpath rather than `../components/...` —
      // tsup's external preserves the specifier verbatim in the
      // output, and a parent-relative path bundled into dist/
      // would escape the dist root at consume time. The subpath
      // resolves through package.json `exports` and is depth-
      // independent.
      "@nexpress/theme-docs/components/toc-scrollspy",
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
