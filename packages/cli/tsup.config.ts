import { defineConfig } from "tsup";
import { cpSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  target: "es2022",
  banner: { js: "#!/usr/bin/env node" },
  // #268 — copy on-disk templates into dist/ so the published CLI
  // tarball can read them at runtime. See `src/template-loader.ts`.
  // The `_typecheck/` subtree is for tsc only (stubs for `@/db/...`
  // and `@/nexpress.config` so lib templates resolve), never copied
  // into a scaffolded project.
  onSuccess: async () => {
    cpSync(resolve("templates"), resolve("dist/templates"), {
      recursive: true,
      filter: (src) => !src.includes("_typecheck"),
    });
  },
});
