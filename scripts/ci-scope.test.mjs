import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
  symlinkSync,
  rmSync,
  readFileSync,
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

test("the workflow checks gate requires both independent jobs and preserves docs skips", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const jobs = workflow.split(/^  ([\w-]+):\s*$/m);
  const gate = jobs[jobs.indexOf("checks-gate") + 1];
  assert.ok(gate);
  const needs = gate.match(/^    needs: \[([^\]]+)\]/m)?.[1].split(/,\s*/);
  assert.deepEqual(needs, ["scope", "checks", "unit-tests"]);
  for (const name of ["checks", "unit-tests"]) {
    const job = jobs[jobs.indexOf(name) + 1];
    assert.match(job, /^    needs: \[scope\]$/m);
    assert.match(job, /^    if: needs.scope.outputs.docs_only != 'true'$/m);
  }
  const bindings = [...gate.matchAll(/^          (\w+): \$\{\{ needs\.([\w.-]+) \}\}$/gm)];
  assert.ok(bindings.length);
  const command = gate.match(/        run: \|\n((?:          [^\n]*\n)+)/)?.[1];
  assert.ok(command);
  const script = command.replace(/^          /gm, "");
  const cases = [
    ["both jobs pass", "success", "false", "success", "success", true],
    ["build fails", "success", "false", "failure", "success", false],
    ["units fail", "success", "false", "success", "failure", false],
    ["units cancel", "success", "false", "success", "cancelled", false],
    ["units missing", "success", "false", "success", "", false],
    ["units skipped", "success", "false", "success", "skipped", false],
    ["classification fails", "failure", "false", "success", "success", false],
    ["docs validation fails", "failure", "true", "skipped", "skipped", false],
    ["validated docs skip both jobs", "success", "true", "skipped", "skipped", true],
    ["docs units unexpectedly run", "success", "true", "skipped", "success", false],
    ["docs units missing", "success", "true", "skipped", "", false],
  ];
  for (const [label, scope, docs, build, units, passed] of cases) {
    const results = {
      "scope.result": scope,
      "scope.outputs.docs_only": docs,
      "checks.result": build,
      "unit-tests.result": units,
    };
    const env = { PATH: process.env.PATH };
    for (const [, name, expression] of bindings) {
      assert.ok(Object.hasOwn(results, expression), expression);
      env[name] = results[expression];
    }
    const child = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      cwd: new URL("../", import.meta.url),
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status === 0, passed, `${label}: ${child.stderr}`);
  }
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
