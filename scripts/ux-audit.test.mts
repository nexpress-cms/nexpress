import assert from "node:assert/strict";
import { test } from "node:test";

import {
  databaseNameForAudit,
  evaluateProbeResponses,
  parseArgs,
  parseComposePort,
  plannedStepLabels,
  scaffoldDestinationConflict,
} from "./ux-audit.mjs";

test("parses quick/keep/name flags and rejects unsafe or missing names", () => {
  assert.deepEqual(parseArgs(["--quick", "--keep", "--name", "release-audit"]), {
    keep: true,
    quick: true,
    help: false,
    name: "release-audit",
  });
  assert.throws(() => parseArgs(["--name"]), /requires a value/);
  assert.throws(() => parseArgs(["--name", "../escape"]), /must start/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown flag/);
});

test("derives safe bounded database names and parses Docker compose ports", () => {
  const databaseName = databaseNameForAudit("release-audit", 42);
  assert.equal(databaseName, "np_ux_release_audit_42");
  assert.ok(databaseName.length <= 63);
  assert.equal(parseComposePort("0.0.0.0:5433\n[::]:5433\n"), 5433);
  assert.equal(parseComposePort("no published port"), undefined);
});

test("refuses an existing scaffold destination without touching it", () => {
  assert.match(
    scaffoldDestinationConflict("/repo/apps/web", () => true) ?? "",
    /choose a different `--name`/,
  );
  assert.equal(
    scaffoldDestinationConflict("/repo/apps/ux-audit-new", () => false),
    undefined,
  );
});

test("quick mode skips only the production probe", () => {
  const full = plannedStepLabels(false);
  const quick = plannedStepLabels(true);
  assert.equal(full.length, 9);
  assert.equal(quick.length, 8);
  assert.deepEqual(full.slice(0, -1), quick);
  assert.equal(full.at(-1), "pnpm start + HTTP probe");
  assert.ok(full.includes("pnpm db:push"));
  assert.ok(full.includes("pnpm run setup -- --non-interactive"));
});

test("accepts the expected public/admin first-run responses", () => {
  assert.deepEqual(
    evaluateProbeResponses([
      { path: "/", status: 200 },
      { path: "/admin", status: 307, redirectedTo: "/admin/login?next=%2Fadmin" },
      { path: "/blog", status: 200 },
      { path: "/api/openapi.json", status: 200 },
      { path: "/api/health", status: 200 },
    ]),
    [],
  );
});

test("reports failed routes and an invalid admin redirect", () => {
  const errors = evaluateProbeResponses([
    { path: "/", status: 500 },
    { path: "/admin", status: 200 },
    { path: "/blog", status: 404 },
    { path: "/api/openapi.json", status: 503 },
    { path: "/api/health", status: 200 },
  ]);
  assert.equal(errors.length, 4);
  assert.match(errors.join("\n"), /login\/setup redirect/);
});
