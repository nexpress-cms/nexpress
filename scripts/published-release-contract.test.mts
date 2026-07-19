import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import {
  analyzePublishedPackageMetadata,
  findUnpublishedWorkspacePackages,
  readPublishableWorkspacePackages,
  verifyPublishedWorkspacePackages,
  type NpPublishedWorkspacePackage,
} from "./published-release-contract.mjs";

const expected: NpPublishedWorkspacePackage = {
  name: "@nexpress/core",
  version: "0.4.1",
  directory: "/workspace/packages/core",
};

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: expected.name,
    version: expected.version,
    dependencies: { zod: "^4.0.0" },
    dist: {
      tarball: "https://registry.npmjs.org/@nexpress/core/-/core-0.4.1.tgz",
      integrity: "sha512-example",
      attestations: {
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
    },
    ...overrides,
  };
}

test("accepts an exact installable package manifest with provenance", () => {
  assert.deepEqual(analyzePublishedPackageMetadata(expected, metadata()), []);
});

test("reports malformed dependencies, identity, tarball, integrity, and provenance drift", () => {
  const errors = analyzePublishedPackageMetadata(
    expected,
    metadata({
      name: "@nexpress/wrong",
      version: "0.4.0",
      dependencies: { "@nexpress/blocks": "workspace:*" },
      optionalDependencies: [],
      peerDependencies: { react: 19 },
      dist: {},
    }),
  );

  assert.match(errors.join("\n"), /registry name is @nexpress\/wrong/);
  assert.match(errors.join("\n"), /registry version is 0\.4\.0/);
  assert.match(errors.join("\n"), /retains workspace:\*/);
  assert.match(errors.join("\n"), /optionalDependencies is not an object/);
  assert.match(errors.join("\n"), /peerDependencies\.react is not a string/);
  assert.match(errors.join("\n"), /dist\.tarball is missing/);
  assert.match(errors.join("\n"), /dist\.integrity is missing/);
  assert.match(errors.join("\n"), /provenance attestation is missing/);
});

test("finds unpublished versions without accepting malformed published metadata", async () => {
  const missing = { ...expected, name: "create-nexpress", version: "0.1.37" };
  const fetchImpl: typeof fetch = async (input) =>
    String(input).includes("create-nexpress")
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(metadata()), { status: 200 });

  assert.deepEqual(await findUnpublishedWorkspacePackages([expected, missing], { fetchImpl }), [
    missing,
  ]);

  await assert.rejects(
    findUnpublishedWorkspacePackages([expected], {
      fetchImpl: async () =>
        new Response(JSON.stringify(metadata({ dependencies: { bad: "workspace:^" } })), {
          status: 200,
        }),
    }),
    /retains workspace:\^/,
  );
});

test("the post-publish gate fails closed when a version never reaches the registry", async () => {
  await assert.rejects(
    verifyPublishedWorkspacePackages([expected], {
      fetchImpl: async () => new Response("not found", { status: 404 }),
      intervalMs: 0,
      timeoutMs: 0,
    }),
    /@nexpress\/core@0\.4\.1: not published/,
  );
});

test("the repository inventory includes every public package and excludes private workspaces", () => {
  const packages = readPublishableWorkspacePackages(resolve(import.meta.dirname, ".."));
  assert.equal(packages.length, 35);
  assert.ok(packages.some((pkg) => pkg.name === "create-nexpress"));
  assert.ok(packages.some((pkg) => pkg.name === "@nexpress/core"));
  assert.ok(!packages.some((pkg) => pkg.name === "@nexpress/web"));
});
