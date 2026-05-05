/**
 * Client-safe entrypoint for `@nexpress/theme`.
 *
 * The root export bundles helpers that pull `@nexpress/core` (and
 * therefore Node-only deps like `pg` and `sharp`) into the module
 * graph. Client components must not import the root — Turbopack
 * walks the graph eagerly and would try to bundle those Node
 * modules into the browser chunk.
 *
 * This file re-exports only the constants + plain helpers that
 * have no `@nexpress/core` dependency, so a `"use client"`
 * component can `import { COLOR_SCHEME_COOKIE } from
 * "@nexpress/theme/client"` without dragging the framework into
 * the browser.
 */
export {
  COLOR_SCHEME_COOKIE,
  COLOR_SCHEME_STORAGE_KEY,
  isColorScheme,
  type NpColorScheme,
} from "./color-scheme-keys.js";
