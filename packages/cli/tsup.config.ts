import { defineConfig } from "tsup";
import { cpSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read `@nexpress/core`'s current version at build time and inject
// it as a literal string into the bundled CLI via esbuild's `define`.
// Scaffolded projects then pin every `@nexpress/*` dep to this exact
// version (rather than a `^0.X.0` range), so a teammate scaffolding
// later against the same `create-nexpress` tarball gets bit-identical
// runtime versions. The pin moves only when `create-nexpress` itself
// is republished — which happens when a changeset for it lands in
// the release pipeline. See `src/templates.ts`.
const corePackageJson: { version: string } = JSON.parse(
  readFileSync(resolve("../core/package.json"), "utf-8"),
);

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  target: "es2022",
  banner: { js: "#!/usr/bin/env node" },
  // The injected token is referenced in `src/templates.ts` via
  // `declare const __NEXPRESS_PACKAGE_VERSION__: string`. esbuild
  // does literal text substitution, so the value must be a valid
  // JS expression — `JSON.stringify` wraps the version in quotes.
  // `vitest.config.ts` declares the same `define` so unit tests see
  // the same string the bundle ships with.
  define: {
    __NEXPRESS_PACKAGE_VERSION__: JSON.stringify(corePackageJson.version),
  },
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
