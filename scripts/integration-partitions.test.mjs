import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSameFiles,
  checkResults,
  parseArgs,
  partitionFiles,
  requireEnvironment,
  runCommand,
} from "./integration-partitions.mjs";

const files = [
  "tests/a.integration.test.ts",
  "tests/nested/b.integration.test.tsx",
  "tests/new.integration.test.ts",
];
const durations = { [files[0]]: 100, [files[1]]: 10, "tests/deleted.integration.test.ts": 9000 };

test("balances measured work deterministically while including new and nested files", () => {
  const groups = partitionFiles(files, durations);
  assert.deepEqual(partitionFiles([...files].reverse(), durations), groups);
  assertSameFiles(
    groups.flatMap((g) => g.files),
    files,
  );
  assert.equal(groups[0].weightMs, 110);
  assert.equal(groups[1].weightMs, 100);
  assert.equal(partitionFiles(files, {})[0].weightMs, 2);
  assert.throws(() => partitionFiles([...files, files[0]], durations), /Duplicate/);
  // Vitest substring filters matching an extra similarly named file must fail.
  assert.throws(
    () => assertSameFiles([...files, "tests/a.integration.test.tsx"], files),
    /differs/,
  );
});

function receipts() {
  return partitionFiles(files, durations).map((group, index) => ({
    version: 1,
    partition: index + 1,
    commit: "test-head",
    status: "success",
    inventory: files,
    files: group.files,
    core: index === 0 ? "success" : "not-assigned",
    redis: index === 1 ? "success" : "not-assigned",
  }));
}

test("aggregate requires exact coverage, current head and successful package ownership", () => {
  assert.equal(checkResults(receipts(), "test-head"), files.length);
  assert.throws(() => checkResults(receipts().slice(1), "test-head"), /Both/);
  for (const status of ["failure", "cancelled", "skipped", "", undefined]) {
    const rows = receipts();
    rows[1].status = status;
    assert.throws(() => checkResults(rows, "test-head"), /status/);
  }
  assert.throws(() => checkResults(receipts(), "other-head"), /identity/);
  for (const mutate of [
    (r) => r[1].files.push(r[0].files[0]),
    (r) => r[0].files.pop(),
    (r) => r[1].inventory.push("tests/missing.integration.test.ts"),
    (r) => (r[1].core = "success"),
    (r) => (r[1].redis = "not-assigned"),
    (r) => (r[1].partition = 1),
  ]) {
    const rows = structuredClone(receipts());
    mutate(rows);
    assert.throws(() => checkResults(rows, "test-head"));
  }
});

test("rejects missing DB/Redis settings and malformed partition invocations before tests", () => {
  assert.deepEqual(parseArgs(["--plan"]), { mode: "plan" });
  assert.equal(parseArgs(["2", "--output", "/tmp/test-results"]).partition, 2);
  for (const args of [
    [],
    ["0"],
    ["3", "--output", "/tmp/x"],
    ["1", "--output", ""],
    ["--plan", "1"],
  ])
    assert.throws(() => parseArgs(args), /Usage/);
  const env = { DATABASE_URL: "postgres://fixture", TEST_DATABASE_URL: "postgres://fixture" };
  requireEnvironment(1, env);
  assert.throws(() => requireEnvironment(1, {}), /DATABASE_URL/);
  assert.throws(
    () => requireEnvironment(1, { ...env, TEST_DATABASE_URL: " " }),
    /TEST_DATABASE_URL/,
  );
  assert.throws(() => requireEnvironment(2, env), /TEST_REDIS_URL/);
  requireEnvironment(2, { ...env, TEST_REDIS_URL: "redis://fixture" });
});

test("runner propagates child failure and termination", () => {
  assert.throws(
    () => runCommand(process.execPath, ["-e", "process.exit(7)"], { stdio: "pipe" }),
    /failed \(7\)/,
  );
  assert.throws(
    () =>
      runCommand(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], {
        stdio: "pipe",
      }),
    /SIGTERM/,
  );
});
