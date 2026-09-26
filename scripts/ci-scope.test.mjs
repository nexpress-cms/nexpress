import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyDiff, detectScope, requireGate } from "./ci-scope.mjs";

const sha = "a".repeat(40);
const event = { pull_request: { base: { sha }, head: { sha } } };
test("only complete, regular documentation changes select the fast path", () => {
  const row = (path, old = "100644", next = "100644", status = "M") =>
    `:${old} ${next} abc def ${status}\0${path}\0`;
  assert.deepEqual(classifyDiff(row("docs/a b\n한글.md")), ["docs/a b\n한글.md"]);
  assert.deepEqual(classifyDiff(row("README.md", "000000", "100644", "A")), ["README.md"]);
  assert.deepEqual(classifyDiff(row("docs/gone.md", "100644", "000000", "D")), []);
  for (const path of [
    "package.json",
    "docs/script.ts",
    ".github/workflows/ci.yml",
    ".changeset/note.md",
    "packages/core/README.md",
    "docs/../code.md",
  ])
    assert.equal(classifyDiff(row("docs/a.md") + row(path)), null, path);
  for (const mode of ["120000", "100755", "160000"])
    for (const pair of [
      [mode, "100644"],
      ["100644", mode],
    ])
      assert.equal(classifyDiff(row("docs/a.md", ...pair)), null);
  for (const malformed of [
    "",
    row("docs/a.md").slice(0, -1),
    ":bad\0docs/a.md\0",
    row("docs/a.md", "100644", "100644", "R100"),
  ])
    assert.equal(classifyDiff(malformed), null);
  for (const name of ["push", "workflow_dispatch", "merge_group", undefined])
    assert.equal(
      detectScope(name, event, () => {
        throw new Error("must not read git");
      }),
      null,
    );
  assert.equal(detectScope("pull_request", {}), null);
  assert.equal(
    detectScope("pull_request", event, () => {
      throw new Error("missing history");
    }),
    null,
  );
});

test("real merge-base history includes code hidden by renames or older PR commits", () => {
  const dir = mkdtempSync(join(tmpdir(), "np-ci-scope-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD").trim();
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs/a.md"), "Original\n");
    writeFileSync(join(dir, "code.js"), "export {};\n");
    const base = commit();
    const scope = () =>
      detectScope(
        "pull_request",
        { pull_request: { base: { sha: base }, head: { sha: git("rev-parse", "HEAD").trim() } } },
        git,
      );
    assert.equal(scope(), null);
    renameSync(join(dir, "docs/a.md"), join(dir, "docs/b.md"));
    commit();
    assert.deepEqual(scope(), ["docs/b.md"]);
    writeFileSync(join(dir, "code.js"), "export const changed = true;\n");
    commit();
    writeFileSync(join(dir, "docs/b.md"), "Later docs\n");
    commit();
    assert.equal(scope(), null);
    git("reset", "--hard", base);
    renameSync(join(dir, "code.js"), join(dir, "docs/code.md"));
    commit();
    assert.equal(scope(), null);
    git("reset", "--hard", base);
    chmodSync(join(dir, "docs/a.md"), 0o755);
    commit();
    assert.equal(scope(), null);
    git("reset", "--hard", base);
    rmSync(join(dir, "docs/a.md"));
    symlinkSync("../code.js", join(dir, "docs/a.md"));
    commit();
    assert.equal(scope(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("required contexts fail closed for missing, failed or cancelled dependencies", () => {
  assert.match(requireGate("success", "true", "skipped"), /Documentation validated/);
  assert.match(requireGate("success", "false", "success"), /Full CI/);
  for (const result of ["failure", "cancelled", "skipped", "", undefined]) {
    assert.throws(() => requireGate(result, "true", "skipped"));
    assert.throws(() => requireGate("success", "false", result));
  }
  for (const mode of ["", undefined, "TRUE"])
    assert.throws(() => requireGate("success", mode, "success"));
  for (const result of ["failure", "cancelled", "success", "", undefined])
    assert.throws(() => requireGate("success", "true", result));
});
