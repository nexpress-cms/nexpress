import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { npAgentHttpRoutesV1 } from "../packages/core/src/agent-contract/agent-http-contract.ts";

const root = new URL("../", import.meta.url);
async function routeFiles(base, prefix = "") {
  const paths = [];
  for (const entry of await readdir(new URL(base + prefix, root), { withFileTypes: true })) {
    if (entry.isDirectory()) paths.push(...(await routeFiles(base, `${prefix}${entry.name}/`)));
    else if (entry.name === "route.ts") paths.push(`${prefix}route.ts`);
  }
  return paths.sort();
}

describe("Agent HTTP reference and packed scaffold boundaries", () => {
  it("ships only the four registered paths as identical thin wrappers", async () => {
    const expected = npAgentHttpRoutesV1
      .map(
        ({ path }) =>
          `${path.slice("/api/agent/v1/".length).replaceAll(/\{([^}]+)\}/gu, "[$1]")}/route.ts`,
      )
      .sort();
    const reference = "apps/web/src/app/api/agent/v1/";
    const snapshot = "packages/cli/templates/snapshot/src/app/api/agent/v1/";
    assert.deepEqual(await routeFiles(reference), expected);
    assert.deepEqual(await routeFiles(snapshot), expected);
    for (const route of npAgentHttpRoutesV1) {
      const suffix = route.path.slice("/api/agent/v1/".length).replaceAll(/\{([^}]+)\}/gu, "[$1]");
      const [web, template] = await Promise.all(
        [reference, snapshot].map((base) =>
          readFile(new URL(`${base}${suffix}/route.ts`, root), "utf8"),
        ),
      );
      assert.equal(template, web);
      assert.equal(
        web.trim(),
        `export const dynamic = "force-dynamic";\nexport const runtime = "nodejs";\nexport { ${route.method} } from "@nexpress/app/api/agent/v1/${suffix}/route";`,
      );
    }
  });
});
