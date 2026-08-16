import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { NpPublishedWorkspacePackage } from "./published-release-contract.mjs";
import {
  bootstrapNpmPackages,
  npmTrustedPublisherAccessUrl,
  parseNpmBootstrapPackageNames,
  selectNpmBootstrapPackages,
} from "./release.mjs";

const originalNodeAuthToken = process.env.NODE_AUTH_TOKEN;

afterEach(() => {
  if (originalNodeAuthToken === undefined) delete process.env.NODE_AUTH_TOKEN;
  else process.env.NODE_AUTH_TOKEN = originalNodeAuthToken;
});

const packages: NpPublishedWorkspacePackage[] = [
  { name: "@nexpress/plugin-shop", version: "0.4.3", directory: "/shop" },
  { name: "@nexpress/theme-storefront", version: "0.4.3", directory: "/storefront" },
  { name: "create-nexpress", version: "0.1.39", directory: "/cli" },
];

test("parses an explicit bounded comma or newline separated bootstrap allowlist", () => {
  assert.deepEqual(
    parseNpmBootstrapPackageNames(
      "@nexpress/plugin-shop, @nexpress/theme-storefront\ncreate-nexpress",
    ),
    ["@nexpress/plugin-shop", "@nexpress/theme-storefront", "create-nexpress"],
  );
  assert.deepEqual(parseNpmBootstrapPackageNames("  "), []);
  assert.throws(
    () => parseNpmBootstrapPackageNames("create-nexpress,create-nexpress"),
    /duplicate create-nexpress/,
  );
  assert.throws(
    () => parseNpmBootstrapPackageNames(Array.from({ length: 51 }, (_, i) => `pkg-${i}`).join(",")),
    /at most 50/,
  );
});

test("selects only exact publishable workspace names in operator order", () => {
  assert.deepEqual(
    selectNpmBootstrapPackages(packages, ["create-nexpress", "@nexpress/plugin-shop"]),
    [packages[2], packages[0]],
  );
  assert.throws(
    () => selectNpmBootstrapPackages(packages, ["@nexpress/not-a-workspace"]),
    /not a publishable workspace/,
  );
});

test("bootstraps unpublished packages sequentially with a scoped token and convergent reruns", async () => {
  delete process.env.NODE_AUTH_TOKEN;
  const events: string[] = [];

  await bootstrapNpmPackages({
    packages,
    unpublished: [packages[0]!, packages[1]!],
    token: "temporary-bootstrap-token",
    publishPackage: async (pkg) => {
      assert.equal(process.env.NODE_AUTH_TOKEN, "temporary-bootstrap-token");
      events.push(`publish:${pkg.name}`);
      if (pkg.name === "@nexpress/plugin-shop") throw new Error("registry already accepted it");
    },
    verifyPublished: async (selected) => {
      assert.equal(process.env.NODE_AUTH_TOKEN, undefined);
      events.push(`exact:${selected.map((pkg) => pkg.name).join("|")}`);
    },
    verifyVisibility: async (selected) => {
      assert.equal(process.env.NODE_AUTH_TOKEN, undefined);
      events.push(`metadata:${selected.map((pkg) => pkg.name).join("|")}`);
    },
  });

  assert.equal(process.env.NODE_AUTH_TOKEN, undefined);
  assert.deepEqual(events, [
    "publish:@nexpress/plugin-shop",
    "publish:@nexpress/theme-storefront",
    "exact:@nexpress/plugin-shop|@nexpress/theme-storefront|create-nexpress",
    "metadata:@nexpress/plugin-shop|@nexpress/theme-storefront|create-nexpress",
  ]);
});

test("prints stable npm Trusted Publisher access URLs", () => {
  assert.equal(
    npmTrustedPublisherAccessUrl("@nexpress/plugin-shop"),
    "https://www.npmjs.com/package/%40nexpress/plugin-shop/access",
  );
  assert.equal(
    npmTrustedPublisherAccessUrl("create-nexpress"),
    "https://www.npmjs.com/package/create-nexpress/access",
  );
});
