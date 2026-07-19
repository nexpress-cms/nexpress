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
  "@nexpress/editor",
  "@nexpress/editor/server",
  "@nexpress/next",
  "@nexpress/next/client",
  "@nexpress/plugin-forum/client",
  "@nexpress/plugin-sdk",
];

// Two-entry array config (matches `@nexpress/admin`'s pattern):
// tsup builds `index` and `client` as separate passes that share
// chunks. Source-side `"use client"` directives in
// `src/client/*.tsx` cause tsup to emit those files as separate
// chunks with the directive at the top, which is what React's
// RSC compiler needs to treat them as client components even
// when they're transitively imported from server-side route
// files (e.g. `src/routes/forum-post-edit.tsx` referencing
// `ForumPostForm`).
//
// The previous sequenced single-entry approach lost this — each
// invocation only saw one entry, so transitive client modules
// got bundled into the server `dist/index.js` without the
// directive, breaking the RSC boundary.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: !fast,
    // No `clean: true` here — the build script does `rm -rf
    // dist` before invoking tsup. Cleaning inside one of the
    // two parallel configs races with the other config's emit
    // (when index's DTS finishes after client's, the cleanup
    // path wipes client.d.ts that was already written).
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
