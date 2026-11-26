import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  npCreateAgentModeratorProposalEvaluationSuiteV2,
  npCreateAgentModeratorProposalEvaluationSuiteV3,
  npBuildAgentEvaluationReportV1,
  runAgentEvaluationV1,
} from "@nexpress/core/agents";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npCompareAgentModeratorProposalEvaluationReviewArtifactsV1,
  npParseAgentEvaluationCommandArgsV1,
  type NpAgentModeratorProposalEvaluationReviewLabelV1,
} from "@nexpress/core/agent-contract";
import {
  formatEvaluationResult,
  prepareEvaluationResultVerifier,
} from "./agent-evaluate-result.js";
import { runNexpressCli } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
const fixtures = new Map<number, Awaited<ReturnType<typeof runAgentEvaluationV1>>>();
async function fixture(version: 1 | 2 | 3 = 1) {
  const cached = fixtures.get(version);
  if (cached) return structuredClone(cached);
  const artifact = await runAgentEvaluationV1({
    suite:
      version === 3
        ? await npCreateAgentModeratorProposalEvaluationSuiteV3()
        : version === 2
          ? await npCreateAgentModeratorProposalEvaluationSuiteV2()
          : await npCreateAgentModeratorProposalEvaluationSuiteV1(),
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
  fixtures.set(version, artifact);
  return structuredClone(artifact);
}
async function directory() {
  const cwd = await mkdtemp(join(tmpdir(), "np-moderator-proposal-cli-"));
  directories.push(cwd);
  return cwd;
}
it("binds both Moderator proposal dataset versions and self-comparisons to the exact requested installed suite", async () => {
  const cwd = await directory();
  const v1 = await fixture();
  const v2 = await fixture(2);
  for (const [version, artifact, otherArtifact] of [
    [1, v1, v2],
    [2, v2, v1],
  ] as const) {
    const baseline = `baseline-${version}.json`;
    await writeFile(join(cwd, baseline), JSON.stringify(artifact));
    const result = {
      schemaVersion: "np.agent-eval-command.v1",
      artifact,
      comparison: await npCompareAgentEvaluationArtifactsV1(artifact, artifact),
      errorCode: null,
    };
    const verify = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1([
        "--dataset",
        `moderator-proposal.v${version}`,
        "--compare",
        baseline,
      ]),
      cwd,
    );
    expect(await verify(result)).toEqual(result);
    expect(result.comparison).toMatchObject({ comparable: true, violationDelta: 0 });
    // Even the same suite ID cannot substitute a differently versioned dataset.
    await expect(
      verify({
        ...result,
        artifact: otherArtifact,
        comparison: await npCompareAgentEvaluationArtifactsV1(otherArtifact, otherArtifact),
      }),
    ).rejects.toThrow("Mismatched evaluation result");
    await expect(verify({ ...result, comparison: null })).rejects.toThrow(
      "Mismatched evaluation comparison",
    );
    await expect(verify({ ...result, detail: "private-child-marker" })).rejects.toThrow();
  }
  const incompatible = await npCompareAgentEvaluationArtifactsV1(v2, v1);
  expect(incompatible).toEqual({ comparable: false, reason: "SUITE_MISMATCH" });
  for (const args of [[], ["--dataset", "moderator-proposal.v1", "--max-calls", "99"]]) {
    const other = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(args),
      cwd,
    );
    await expect(
      other({
        schemaVersion: "np.agent-eval-command.v1",
        artifact: v1,
        comparison: null,
        errorCode: null,
      }),
    ).rejects.toThrow("Mismatched evaluation result");
  }
}, 20_000);
// Captures inputs independently, then exercises one actual npm child through the CLI boundary.
// The timeout covers repeated bounded hash verification, not product latency.
it("binds content-evidence Moderator proposal review output to exact source, labels and comparison before child execution", async () => {
  const cwd = await directory();
  const content = await fixture(3);
  const source = await runAgentEvaluationV1({
    suite: {
      ...content.suite,
      cases: [content.suite.cases.find((c) => c.id === "mp-en-content-unavailable")!],
    },
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget: content.budget,
  });
  const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source);
  const entry = template.entries.find(
    (e) => e.eligible && e.response?.decision.kind === "complete",
  )!;
  const labels: NpAgentModeratorProposalEvaluationReviewLabelV1[] = [
    {
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash: entry.sourceHash,
      outcome: "accept",
      reviewer: "local-reviewer",
      reviewedAt: "2026-10-08T00:00:00.000Z",
      notes: "Synthetic abstention review.",
      editedProposal: null,
    },
  ];
  const artifact = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, labels);
  const comparison = await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(
    artifact,
    artifact,
  );
  const result = {
    schemaVersion: "np.agent-moderator-proposal-eval-review-command.v1",
    artifact,
    comparison,
    errorCode: null,
  };
  await Promise.all([
    writeFile(join(cwd, "source.json"), JSON.stringify(source)),
    writeFile(join(cwd, "labels.json"), JSON.stringify(labels)),
    writeFile(join(cwd, "baseline.json"), JSON.stringify(artifact)),
    writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ private: true, scripts: { "agent:evaluate": "node evaluate.mjs" } }),
    ),
    writeFile(join(cwd, "package-lock.json"), "{}"),
    writeFile(
      join(cwd, "evaluate.mjs"),
      `process.stderr.write("private-child-marker");process.stdout.write(${JSON.stringify(JSON.stringify(result))});`,
    ),
  ]);
  const args = [
    "--review",
    "source.json",
    "--reviews",
    "labels.json",
    "--compare",
    "baseline.json",
    "--json",
  ];
  const verify = await prepareEvaluationResultVerifier(
    npParseAgentEvaluationCommandArgsV1(args),
    cwd,
  );
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  expect(await runNexpressCli(["node", "nexpress", "agent", "evaluate", ...args], { cwd })).toBe(0);
  expect(JSON.parse(output)).toEqual(result);
  expect(formatEvaluationResult(await verify(result))).toContain("1 reviewed");
  expect(output).not.toContain("private-child-marker");

  const changedSource = {
    ...source,
    startedAt: "2026-10-08T01:00:00.000Z",
    finishedAt: "2026-10-08T01:00:01.000Z",
  };
  const otherArtifact =
    await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(changedSource);
  // A child replacing files cannot replace the inputs already captured by the verifier.
  await Promise.all([
    writeFile(join(cwd, "source.json"), JSON.stringify(changedSource)),
    writeFile(join(cwd, "labels.json"), "[]"),
    writeFile(join(cwd, "baseline.json"), JSON.stringify(template)),
  ]);
  expect(await verify(result)).toEqual(result);
  for (const wrong of [
    { ...result, artifact: template },
    { ...result, artifact: otherArtifact },
    { ...result, artifact: { ...artifact, summary: { ...artifact.summary, reviewed: 99 } } },
    { ...result, comparison: null },
    { ...result, comparison: { ...comparison, acceptBasisPointsDelta: 10_000 } },
    { ...result, detail: "private-child-marker" },
  ])
    await expect(verify(wrong)).rejects.toThrow("Mismatched Moderator proposal review result");
}, 20_000);

it("independently reconstructs V2 report evidence and keeps incompatible V1 baselines explicit", async () => {
  const cwd = await directory();
  const evaluation = await fixture(2);
  const baseline = await fixture();
  const review = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(evaluation);
  const input = {
    schemaVersion: "np.agent-eval-report-input.v1" as const,
    entries: [
      {
        recipe: "moderator-proposal" as const,
        current: { evaluation, review },
        baseline: { evaluation: baseline, review: null },
      },
    ],
  };
  const artifact = await npBuildAgentEvaluationReportV1(input);
  const result = { schemaVersion: "np.agent-eval-report-command.v1", artifact, errorCode: null };
  await Promise.all([
    writeFile(join(cwd, "source.json"), JSON.stringify(evaluation)),
    writeFile(join(cwd, "review.json"), JSON.stringify(review)),
    writeFile(join(cwd, "baseline.json"), JSON.stringify(baseline)),
    writeFile(
      join(cwd, "manifest.json"),
      JSON.stringify({
        schemaVersion: "np.agent-eval-report-manifest.v1",
        entries: [
          {
            recipe: "moderator-proposal",
            evaluation: "source.json",
            review: "review.json",
            baseline: { evaluation: "baseline.json", review: null },
          },
        ],
      }),
    ),
  ]);
  const verify = await prepareEvaluationResultVerifier(
    npParseAgentEvaluationCommandArgsV1(["--report", "manifest.json"]),
    cwd,
  );
  expect(await verify(result)).toEqual(result);
  expect(
    artifact.rows.find((row) => row.recipe === "moderator-proposal")?.evaluationComparison.result,
  ).toEqual({ comparable: false, reason: "SUITE_MISMATCH" });
  expect(artifact.fullR6).toBe("not-established");
  expect(() => verify({ ...result, artifact: { ...artifact, fullR6: "passed" } })).toThrow(
    "Mismatched evaluation report result",
  );
}, 20_000);

// One cached V3 replay, then actual installed-child verification of each emitted artifact.
it("binds requested V3 content evaluation and self-comparison while refusing V1/V2 child substitutions", async () => {
  const cwd = await directory();
  const artifact = await fixture(3);
  expect(artifact.suite).toMatchObject({ id: "moderator-proposal-review", version: 3 });
  expect(artifact.ok).toBe(true);
  expect(
    artifact.caseResults.some((c) => {
      const decision = c.prediction?.moderatorResponse?.decision;
      return (
        decision?.kind === "propose-capability" &&
        decision.arguments.proposal.target.kind === "document"
      );
    }),
  ).toBe(true);
  await Promise.all([
    writeFile(join(cwd, "baseline.json"), JSON.stringify(artifact)),
    writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        private: true,
        scripts: { "agent:evaluate": "node evaluate.mjs" },
      }),
    ),
    writeFile(join(cwd, "package-lock.json"), "{}"),
  ]);
  const args = ["--dataset", "moderator-proposal.v3", "--compare", "baseline.json", "--json"];
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  const result = {
    schemaVersion: "np.agent-eval-command.v1",
    artifact,
    comparison: await npCompareAgentEvaluationArtifactsV1(artifact, artifact),
    errorCode: null,
  };
  const emitChild = (value: unknown) =>
    writeFile(
      join(cwd, "evaluate.mjs"),
      `process.stderr.write("private-child-marker");process.stdout.write(${JSON.stringify(JSON.stringify(value))});`,
    );
  await emitChild(result);
  expect(await runNexpressCli(["node", "nexpress", "agent", "evaluate", ...args], { cwd })).toBe(0);
  expect(JSON.parse(output)).toEqual(result);
  expect(result.comparison).toMatchObject({ comparable: true, violationDelta: 0 });
  expect(output).not.toContain("private-child-marker");
  for (const version of [1, 2] as const) {
    const legacy = await fixture(version);
    const comparison = await npCompareAgentEvaluationArtifactsV1(legacy, artifact);
    expect(comparison).toEqual({ comparable: false, reason: "SUITE_MISMATCH" });
    await emitChild({ ...result, artifact: legacy, comparison });
    output = "";
    expect(await runNexpressCli(["node", "nexpress", "agent", "evaluate", ...args], { cwd })).toBe(
      1,
    );
    expect(JSON.parse(output)).toEqual({
      schemaVersion: "np.agent-eval-command.v1",
      artifact: null,
      comparison: null,
      errorCode: "EVALUATION_UNAVAILABLE",
    });
    expect(output).not.toContain("private-child-marker");
  }
}, 20_000);
