import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

/**
 * Two entries:
 *   - `index` — server-only block definition + the POST route handler
 *     that writes to plugin storage.
 *   - `subscribe-form` — interactive `<form>` UI. The source file's
 *     leading `"use client"` directive must survive the bundle so
 *     Next.js sees it as a client component. esbuild keeps directive
 *     prologues by default; we verify post-build that the emitted
 *     file's first line is still `"use client"`.
 */
export default defineConfig({
  entry: {
    index: "src/index.tsx",
    "subscribe-form": "src/subscribe-form.tsx",
  },
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  // Self-import (`@nexpress/plugin-block-newsletter/client`) is marked
  // external so the index entry keeps an `import` line crossing into the
  // client-component subpath instead of inlining the form body. Esbuild
  // can't resolve the path at build time anyway — `dist/subscribe-form.js`
  // hasn't been emitted yet — so external is the only working option.
  external: ["react", "@nexpress/plugin-block-newsletter/client"],
  // Without `splitting: false`, esbuild pulls the SubscribeForm body into
  // a shared chunk file that doesn't carry the `"use client"` directive —
  // Next.js then sees a server bundle that calls `useState` and fails at
  // render. Each entry compiles into a self-contained file so the
  // client-component file keeps its directive prologue.
  splitting: false,
});
