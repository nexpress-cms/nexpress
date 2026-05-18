import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Mirror of the `define` block in `tsup.config.ts` — see that file
// for the rationale. Tests exercise the same templates the bundled
// CLI ships, so the injected `__NEXPRESS_PACKAGE_VERSION__` value
// must match in both build paths or the templates test would assert
// against one string while the production build emits a different
// one.
const corePackageJson: { version: string } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../core/package.json"), "utf-8"),
);

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
  define: {
    __NEXPRESS_PACKAGE_VERSION__: JSON.stringify(corePackageJson.version),
  },
});
