import { defineConfig } from "tsup";

/*
 * Two-entry build:
 *   - `index.ts` is the server-safe root that may import
 *     `@nexpress/core` for token sanitization helpers.
 *   - `client.ts` is the browser-safe subset (cookie / storage
 *     keys + a tiny type guard) used from `"use client"`
 *     components. Keeping it in its own bundle prevents
 *     Turbopack from walking into core when a client
 *     component imports a constant.
 */
const fast = process.env.NX_DEV_FAST === "1";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts"],
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: ["react", "react-dom"],
});
