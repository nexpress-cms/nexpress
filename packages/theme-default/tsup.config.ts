import { defineConfig } from "tsup";

/*
 * Two-entry build so the client component (the member status
 * widget that uses `useRouter`/`useEffect`/`useState`) lives
 * in its own output file with a `"use client"` banner. Next.js
 * recognizes the directive at the package boundary and only
 * loads the widget into the client bundle. The server entry
 * (`index.ts`, exporting the theme manifest + server header /
 * footer / shell) marks the widget file as external so the
 * inlined import survives across the bundle split.
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
    ],
  },
  {
    entry: {
      "components/member-status-widget":
        "src/components/member-status-widget.tsx",
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
