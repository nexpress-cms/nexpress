import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import { batchOptions, batches, discoverFiles, parseArgs, runBatches } from "./lint-batches.mjs";

async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "np-lint-batches-"));
  await mkdir(path.join(cwd, "src/ignored"), { recursive: true });
  await writeFile(
    path.join(cwd, "eslint.config.mjs"),
    "export default [{ ignores: ['src/ignored/**'] }, { files: ['**/*.ts'], rules: { 'no-unused-vars': 'error' } }];\n",
  );
  for (const name of ["a.js", "b.ts", "c.mjs", "d.txt", "ignored/e.js"])
    await writeFile(path.join(cwd, "src", name), "export const value = 1;\n");
  return { cwd, dispose: () => rm(cwd, { recursive: true, force: true }) };
}

test("discovers exactly configured extensions and ignores while deduplicating overlapping targets", async () => {
  const f = await fixture();
  try {
    const plan = parseArgs(["src", "src/b.ts", "src/a.js"]);
    const actual = await discoverFiles(plan, f.cwd);
    const eslint = new ESLint({ cwd: f.cwd });
    const expected = (await eslint.lintFiles(["src"]))
      .map((result) => path.relative(f.cwd, result.filePath))
      .sort();
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual, ["src/a.js", "src/b.ts", "src/c.mjs"]);
    assert.deepEqual(
      await discoverFiles(parseArgs(["src", "--", "--ext", ".txt"]), f.cwd),
      [...expected, "src/d.txt"].sort(),
    );
    assert.ok(
      (await discoverFiles(parseArgs(["src", "--", "--no-ignore"]), f.cwd)).includes(
        "src/ignored/e.js",
      ),
    );
    assert.deepEqual(await discoverFiles(parseArgs(["src/ignored/e.js"]), f.cwd), [
      "src/ignored/e.js",
    ]);
    await assert.rejects(discoverFiles(parseArgs(["missing"]), f.cwd), /does not exist/);
    await assert.rejects(discoverFiles(parseArgs(["src/ignored"]), f.cwd), /No unignored/);
  } finally {
    await f.dispose();
  }
});

test("runs every file once in sequential bounded children and aggregates failures beyond the first batch", async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 34; index++)
      await writeFile(path.join(f.cwd, "src", `extra-${index}.js`), "export {};\n");
    const plan = parseArgs(["src", "--", "--cache", "--cache-location", "cache/routes"]);
    const calls = [],
      output = [];
    const result = await runBatches(plan, {
      cwd: f.cwd,
      env: {},
      output: (line) => output.push(line),
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: calls.length === 1 ? 1 : calls.length === 2 ? 2 : 0 };
      },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.batchCount, 3);
    assert.equal(calls.length, 3);
    const actual = calls.flatMap((call) => call.args.slice(1, call.args.indexOf("--cache")));
    assert.deepEqual(actual, result.files);
    assert.equal(new Set(actual).size, 37);
    assert.ok(batches(result.files).every((group) => group.length <= 16));
    assert.ok(
      calls.every(
        (call) =>
          call.options.cwd === f.cwd &&
          call.options.env.NODE_OPTIONS === "--max-old-space-size=6144",
      ),
    );
    const caches = calls.map((call) => call.args.at(-1));
    assert.equal(new Set(caches).size, 3);
    assert.equal(batchOptions(plan, batches(result.files)[0], f.cwd).at(-1), caches[0]);
    assert.ok(output.some((line) => line.includes("batch 1 failed")));
    assert.ok(output.some((line) => line.includes("batch 2 failed")));
  } finally {
    await f.dispose();
  }
});

test("preserves explicit config/ignore/extension options and rejects ambiguous invocations before running", () => {
  const plan = parseArgs([
    "src",
    "--",
    "--config=custom.mjs",
    "--ignore-pattern",
    "**/omit/**",
    "--ext=.jsx,.cts",
    "--cache",
    "--cache-location=cache",
    "--max-warnings",
    "0",
  ]);
  assert.equal(plan.discovery.overrideConfigFile, "custom.mjs");
  assert.equal(
    parseArgs(["src", "--", "--config", "custom.mjs", "--no-config-lookup"]).discovery
      .overrideConfigFile,
    "custom.mjs",
  );
  assert.deepEqual(plan.discovery.ignorePatterns, ["**/omit/**"]);
  assert.deepEqual(plan.discovery.overrideConfig, [{ files: ["**/*.jsx", "**/*.cts"] }]);
  assert.ok(
    batchOptions(plan, ["src/a.jsx"], "/tmp").some((value) =>
      value.startsWith("--cache-location=/tmp/cache.batches/"),
    ),
  );
  assert.deepEqual(batchOptions(parseArgs(["src"]), ["src/a.js"], "/tmp"), []);
  for (const args of [
    [],
    ["--cache"],
    ["src", "--", "--fix"],
    ["src", "--", "--cache-location"],
    ["src", "--", "--max-warnings", "10"],
  ])
    assert.throws(() => parseArgs(args));
});

test("executes the real ESLint CLI with the fixture's rules, ignores and failing exit status", async () => {
  const f = await fixture();
  try {
    const options = {
      cwd: f.cwd,
      output: () => {},
      spawn: (command, args, settings) => spawnSync(command, args, { ...settings, stdio: "pipe" }),
    };
    assert.equal((await runBatches(parseArgs(["src"]), options)).exitCode, 0);
    await writeFile(path.join(f.cwd, "src/b.ts"), "const unused = 1;\n");
    assert.equal((await runBatches(parseArgs(["src"]), options)).exitCode, 1);
    assert.equal(
      (await runBatches(parseArgs(["src/ignored/e.js", "--", "--max-warnings", "0"]), options))
        .exitCode,
      1,
    );
  } finally {
    await f.dispose();
  }
});
