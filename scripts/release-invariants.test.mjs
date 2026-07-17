import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import { analyzeFixedFamily, checkReleaseInvariants } from "./release-invariants.mjs";

const baseWorkspaces = [
  { name: "@nexpress/core" },
  { name: "@nexpress/plugin-sdk" },
  { name: "@nexpress/web", private: true },
  { name: "create-nexpress" },
];

test("accepts exactly one sorted fixed group containing every public @nexpress/* package", () => {
  const result = analyzeFixedFamily(baseWorkspaces, {
    fixed: [["@nexpress/core", "@nexpress/plugin-sdk"]],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.publicFamily, ["@nexpress/core", "@nexpress/plugin-sdk"]);
});

test("reports missing, extra, duplicate, and unsorted family entries", () => {
  const result = analyzeFixedFamily(baseWorkspaces, {
    fixed: [["@nexpress/plugin-sdk", "@nexpress/core", "@nexpress/core", "@nexpress/web"]],
  });

  assert.deepEqual(result.errors, [
    "Duplicate fixed-family entries: @nexpress/core.",
    "Fixed-family entries that are not publishable workspace packages: @nexpress/web.",
    "The fixed @nexpress/* family must remain alphabetically sorted.",
  ]);

  const missing = analyzeFixedFamily(baseWorkspaces, {
    fixed: [["@nexpress/core"]],
  });
  assert.match(missing.errors.join("\n"), /@nexpress\/plugin-sdk/);

  const split = analyzeFixedFamily(baseWorkspaces, {
    fixed: [["@nexpress/core"], ["@nexpress/plugin-sdk"]],
  });
  assert.match(split.errors.join("\n"), /exactly one fixed group/);

  const malformed = analyzeFixedFamily(baseWorkspaces, {
    fixed: [["@nexpress/core", "@nexpress/plugin-sdk", 42]],
  });
  assert.match(malformed.errors.join("\n"), /package-name string/);
});

test("the repository's publishable package inventory satisfies the fixed-family policy", () => {
  const result = checkReleaseInvariants(resolve(import.meta.dirname, ".."));
  assert.deepEqual(result.errors, []);
  assert.equal(result.publicFamily.length, 33);
  assert.deepEqual(result.fixedFamily, result.publicFamily);
});
