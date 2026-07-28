import assert from "node:assert/strict";
import { test } from "node:test";

import {
  planAccidentalFamilyReleaseRepair,
  repairAccidentalFamilyRelease,
} from "./npm-release-repair.mjs";
import type { NpPublishedWorkspacePackage } from "./published-release-contract.mjs";

const packages: NpPublishedWorkspacePackage[] = [
  { name: "@nexpress/core", version: "0.4.2", directory: "/workspace/core" },
  {
    name: "@nexpress/theme-community",
    version: "0.4.2",
    directory: "/workspace/theme-community",
  },
  { name: "create-nexpress", version: "0.1.38", directory: "/workspace/create-nexpress" },
];

test("plans only the fixed @nexpress family and skips a missing accidental version", async () => {
  const plans = await planAccidentalFamilyReleaseRepair(
    packages,
    "0.5.0",
    "0.4.2",
    async (input) => {
      assert.match(String(input), /\/0\.5\.0$/);
      return String(input).includes("theme-community")
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify({ version: "0.5.0" }));
    },
  );

  assert.deepEqual(
    plans.map(({ name, previousVersionExists }) => ({ name, previousVersionExists })),
    [
      { name: "@nexpress/core", previousVersionExists: true },
      { name: "@nexpress/theme-community", previousVersionExists: false },
    ],
  );
});

test("rejects malformed versions and a target that differs from workspace manifests", async () => {
  await assert.rejects(
    planAccidentalFamilyReleaseRepair(packages, "latest", "0.4.2"),
    /exact semver/,
  );
  await assert.rejects(
    planAccidentalFamilyReleaseRepair(packages, "0.5.0", "0.4.3"),
    /does not match/,
  );
  await assert.rejects(
    planAccidentalFamilyReleaseRepair(packages, "0.4.2", "0.4.2"),
    /cannot deprecate/,
  );
});

test("deprecates existing accidental versions, resets latest, and verifies both", async () => {
  const commands: string[][] = [];
  let repaired = false;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const isTheme = url.includes("theme-community");
    const message = "Accidental @nexpress/core@0.5.0 release; use @nexpress/core@0.4.2.";
    if (url.includes("/-/package/")) {
      return new Response(JSON.stringify({ latest: repaired ? "0.4.2" : "0.5.0" }));
    }
    if (isTheme) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(repaired ? { deprecated: message } : {}));
  };

  await repairAccidentalFamilyRelease(packages, "0.5.0", "0.4.2", {
    fetchImpl,
    execFile: ((_command: string, args: readonly string[]) => {
      commands.push([...args]);
      if (commands.length === 3) repaired = true;
      return Buffer.from("");
    }) as typeof import("node:child_process").execFileSync,
    intervalMs: 0,
    timeoutMs: 0,
  });

  assert.deepEqual(commands, [
    [
      "deprecate",
      "@nexpress/core@0.5.0",
      "Accidental @nexpress/core@0.5.0 release; use @nexpress/core@0.4.2.",
    ],
    ["dist-tag", "add", "@nexpress/core@0.4.2", "latest"],
    ["dist-tag", "add", "@nexpress/theme-community@0.4.2", "latest"],
  ]);
});
