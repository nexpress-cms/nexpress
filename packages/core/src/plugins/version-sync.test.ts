import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getFrameworkVersion, resetFrameworkVersion } from "./compat.js";

/**
 * The framework version is hardcoded in `compat.ts` because the package
 * lives outside `rootDir` and a JSON import would force a tsconfig-wide
 * change. This test enforces the manual sync — bumping `package.json`'s
 * `version` requires bumping the constant in `compat.ts` (or vice versa),
 * and CI will fail until they match.
 */
describe("framework version sync", () => {
  it("matches the version field in the package's package.json", async () => {
    resetFrameworkVersion();
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };
    expect(getFrameworkVersion()).toBe(pkg.version);
  });
});
