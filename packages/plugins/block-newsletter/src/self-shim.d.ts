/**
 * Ambient declaration for the package's own `./client` subpath
 * (`@nexpress/plugin-block-newsletter/client`).
 *
 * Why: tsup builds `index` + `subscribe-form` as parallel entries
 * inside a single config. When the dts step for `index.tsx`
 * tries to resolve `@nexpress/plugin-block-newsletter/client`,
 * the package's `exports` map points at `dist/subscribe-form.d.ts`
 * — which the OTHER entry's dts step is still emitting. Fresh
 * builds (e.g. CI without cached dist) race and the index dts
 * fails with "Could not find a declaration file".
 *
 * This shim lets the dts resolver see the type without crossing
 * into the `exports` map → filesystem path. Runtime imports
 * still go through the exports map at consumer load time, so
 * the `"use client"` boundary stays intact.
 */
declare module "@nexpress/plugin-block-newsletter/client" {
  export { SubscribeForm } from "./subscribe-form.js";
}
