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
  const offline = {
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
  };
  const evaluation = await agents.runAgentEvaluationV1({
    ...offline,
    suite: await agents.npCreateAgentOperatorPlanEvaluationSuiteV1(),
  });
  const review = await contracts.npBuildAgentOperatorPlanEvaluationReviewArtifactV1(evaluation);
  const evidence = { evaluation, review };
  const assessments = await Promise.all(
    [
      agents.npCreateAgentModeratorAssessmentEvaluationSuiteV1,
      agents.npCreateAgentModeratorSegmentedEvaluationSuiteV2,
      agents.npCreateAgentMemberReportEvaluationSuiteV1,
    ].map(async (factory) => agents.runAgentEvaluationV1({ ...offline, suite: await factory() })),
  );
  const expected = await agents.npBuildAgentEvaluationReportV2(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-eval-report-input.v2",
        entries: [
          { recipe: "operator", current: evidence, baseline: evidence },
          ...assessments.map((evaluation) => ({
            recipe: "moderator-assessment",
            current: { evaluation, review: null },
            baseline: null,
          })),
        ],
      }),
    ),
  );
  const manifest = {
    schemaVersion: "np.agent-eval-report-manifest.v2",
    entries: [
      {
        recipe: "operator",
        evaluation: "evaluation.json",
        review: "review.json",
        baseline: { evaluation: "evaluation.json", review: "review.json" },
      },
      ...assessments.map(({ suite }) => ({
        recipe: "moderator-assessment",
        evaluation: `${suite.id}.json`,
        review: null,
        baseline: null,
      })),
    ],
  };
  for (const [name, value] of Object.entries({ evaluation, review, manifest }))
    await writeFile(join(directory, `${name}.json`), JSON.stringify(value));
  for (const assessment of assessments)
    await writeFile(join(directory, `${assessment.suite.id}.json`), JSON.stringify(assessment));
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
  for (const [dataset, recipe] of [
    ["moderator-assessment.v1", "moderator-assessment"],
    ["publisher.v3", "publisher-selection"],
  ]) {
    const evaluationPath = join(directory, `${recipe}.json`);
    const evaluationChild = spawnSync(
      "pnpm",
      [
        "exec",
        "nexpress",
        "agent",
        "evaluate",
        "--dataset",
        dataset,
        "--out",
        evaluationPath,
        "--json",
      ],
      { cwd: scaffoldDir, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
    );
    assert.ifError(evaluationChild.error);
    assert.equal(evaluationChild.status, 0, evaluationChild.stderr || evaluationChild.stdout);
    const profile = JSON.parse(await readFile(evaluationPath, "utf8"));
    assert.equal(profile.ok, true);
    assert.equal(profile.mode, "fake");
    const profileReview = await contracts.npBuildAgentProfileEvaluationReviewArtifactV1(profile);
    assert.equal(profileReview.summary.reviewed, 0);
    const reviewPath = join(directory, `${recipe}-review.json`);
    for (const extra of [
      ["--out", reviewPath],
      ["--compare", reviewPath],
    ]) {
      const reviewChild = spawnSync(
        "pnpm",
        ["exec", "nexpress", "agent", "evaluate", "--review", evaluationPath, ...extra, "--json"],
        { cwd: scaffoldDir, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
      );
      assert.ifError(reviewChild.error);
      assert.equal(reviewChild.status, 0, reviewChild.stderr || reviewChild.stdout);
      assert.deepEqual(JSON.parse(reviewChild.stdout).artifact, profileReview);
    }
    const workbench = await agents.npBuildAgentEvaluationWorkbenchV1({
      schemaVersion: "np.agent-eval-workbench-request.v1",
      recipe,
      evaluation: profile,
      review: profileReview,
      baseline: null,
      baselineReview: null,
      labels: null,
    });
    assert.equal(workbench.fixtureGate, "passed");
    assert.equal(workbench.authority, "offline-self-reported-no-approval");
    console.log(`Installed ${dataset} fake evaluation/review/Workbench passed.`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
