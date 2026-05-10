import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

const externals = [
  "next",
  "next/headers",
  "next/navigation",
  "next/link",
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@nexpress/core",
];

// Two-entry array config so source-side `"use client"`
// directives in `src/comments.tsx` get preserved as separate
// chunks tsup emits (React's RSC compiler needs the directive
// at file top, not just bundled-in via banner).
//
// `clean: true` lives in the npm `build` script
// (`rm -rf dist && tsup`) rather than per-entry: when index's
// DTS build happens to finish after client's, an in-config
// clean step would wipe the client.d.ts that already landed.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    external: externals,
  },
  {
    entry: { client: "src/client.ts" },
    format: ["esm"],
    dts: !fast,
    sourcemap: !fast,
    esbuildOptions(options) {
      options.banner = { js: '"use client";' };
    },
    external: externals,
  },
]);
