#!/usr/bin/env node
// Exercise large report output through the installed CLI and real project script.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scaffoldDir = resolve(process.argv[2] ?? process.cwd());
const require = createRequire(join(scaffoldDir, "package.json"));
const agents = await import(pathToFileURL(require.resolve("@nexpress/core/agents")).href);
const contracts = await import(
  pathToFileURL(require.resolve("@nexpress/core/agent-contract")).href
);
const directory = await mkdtemp(join(scaffoldDir, ".np-evaluation-report-"));
try {
  const evaluation = await agents.runAgentEvaluationV1({
    suite: await agents.npCreateAgentOperatorPlanEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget: {
      maxCalls: 100,
      maxInputTokens: 100_000,
      maxOutputTokens: 100_000,
      maxCostMicros: 0,
      timeoutMs: 5000,
    },
  });
  const review = await contracts.npBuildAgentOperatorPlanEvaluationReviewArtifactV1(evaluation);
  const evidence = { evaluation, review };
  const expected = await agents.npBuildAgentEvaluationReportV1(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-eval-report-input.v1",
        entries: [{ recipe: "operator", current: evidence, baseline: evidence }],
      }),
    ),
  );
  const manifest = {
    schemaVersion: "np.agent-eval-report-manifest.v1",
    entries: [
      {
        recipe: "operator",
        evaluation: "evaluation.json",
        review: "review.json",
        baseline: { evaluation: "evaluation.json", review: "review.json" },
      },
    ],
  };
  for (const [name, value] of Object.entries({ evaluation, review, manifest }))
    await writeFile(join(directory, `${name}.json`), JSON.stringify(value));
  const destination = join(directory, "report.json");
  const child = spawnSync(
    "pnpm",
    [
      "exec",
      "nexpress",
      "agent",
      "evaluate",
      "--report",
      join(directory, "manifest.json"),
      "--out",
      destination,
      "--json",
    ],
    { cwd: scaffoldDir, encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.ok(Buffer.byteLength(JSON.stringify(expected)) > 65_536, "Report must exceed pipe buffer");
  const result = JSON.parse(child.stdout);
  assert.equal(result.schemaVersion, "np.agent-eval-report-command.v1");
  assert.equal(result.errorCode, null);
  assert.ok(isDeepStrictEqual(result.artifact, expected), "CLI report must match source evidence");
  assert.ok(
    isDeepStrictEqual(JSON.parse(await readFile(destination, "utf8")), expected),
    "Saved report must match complete stdout",
  );
  console.log(
    `Installed evaluation report pipe passed (${Buffer.byteLength(child.stdout)} bytes).`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
