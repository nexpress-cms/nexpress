import { defineConfig } from "tsup";

/*
 * Two-entry build so client components (the member status
 * widget that uses `useRouter`/`useEffect`/`useState`,
 * the dark-mode toggle, mobile nav, and newsletter form)
 * live in their own output file with a
 * `"use client"` banner. Next.js recognizes the directive at
 * the package boundary and only loads them into the client
 * bundle. The server entry (`index.ts`, exporting the theme
 * manifest + server header / footer / shell) marks each
 * client file as external so the inlined imports survive
 * across the bundle split.
 */
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
      "next/navigation",
      "@nexpress/blocks",
      "@nexpress/theme",
      "./components/member-status-widget.js",
      "./components/dark-mode-toggle.js",
      "./components/language-picker.js",
      "./components/mobile-nav.js",
      "./components/newsletter-form.js",
      "./components/footer-columns.js",
    ],
  },
  {
    entry: {
      "components/member-status-widget":
        "src/components/member-status-widget.tsx",
      "components/dark-mode-toggle":
        "src/components/dark-mode-toggle.tsx",
      "components/language-picker":
        "src/components/language-picker.tsx",
      "components/mobile-nav": "src/components/mobile-nav.tsx",
      "components/newsletter-form": "src/components/newsletter-form.tsx",
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
      "next/navigation",
      "@nexpress/blocks",
      "@nexpress/theme",
    ],
    banner: { js: '"use client";' },
  },
  {
    entry: {
      "components/footer-columns": "src/components/footer-columns.tsx",
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
      "next/navigation",
      "@nexpress/blocks",
      "@nexpress/theme",
      "./newsletter-form.js",
    ],
  },
]);
