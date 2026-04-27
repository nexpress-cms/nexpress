import { defineConfig } from "tsup";

/*
 * Two-entry build so client components (the member status
 * widget that uses `useRouter`/`useEffect`/`useState`, and
 * the dark-mode toggle) live in their own output file with a
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
    ],
  },
  {
    entry: {
      "components/member-status-widget":
        "src/components/member-status-widget.tsx",
      "components/dark-mode-toggle":
        "src/components/dark-mode-toggle.tsx",
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
]);
