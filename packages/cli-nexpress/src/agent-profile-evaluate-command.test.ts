import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  npCreateAgentModeratorAssessmentEvaluationSuiteV1,
  npCreateAgentPublisherSelectionEvaluationSuiteV1,
  runAgentEvaluationV1,
} from "@nexpress/core/agents";
import {
  npBuildAgentEvaluationArtifactV1,
  npBuildAgentProfileEvaluationReviewArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npCompareAgentProfileEvaluationReviewArtifactsV1,
  npParseAgentEvaluationCommandArgsV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentProfileEvaluationReviewLabelV1,
} from "@nexpress/core/agent-contract";
import {
  formatEvaluationResult,
  prepareEvaluationResultVerifier,
} from "./agent-evaluate-result.js";
import { runNexpressCli } from "./index.js";

const datasets = ["moderator-assessment.v1", "publisher.v3"] as const;
type Dataset = (typeof datasets)[number];
const artifacts = new Map<Dataset, NpAgentEvaluationArtifactV1>();
const directories: string[] = [];
const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
beforeAll(async () => {
  for (const dataset of datasets)
    artifacts.set(
      dataset,
      await runAgentEvaluationV1({
        suite:
          dataset === "publisher.v3"
            ? await npCreateAgentPublisherSelectionEvaluationSuiteV1()
            : await npCreateAgentModeratorAssessmentEvaluationSuiteV1(),
        mode: "fake",
        providerId: "fake",
        model: "deterministic-v1",
        budget,
      }),
    );
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function source(dataset: Dataset) {
  const artifact = artifacts.get(dataset);
  if (!artifact) throw new Error("Missing profile fixture.");
  return structuredClone(artifact);
}
async function project(result: unknown) {
  const cwd = await mkdtemp(join(tmpdir(), "np-profile-cli-"));
  directories.push(cwd);
  await Promise.all([
    writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ private: true, scripts: { "agent:evaluate": "node evaluate.mjs" } }),
    ),
    writeFile(join(cwd, "package-lock.json"), "{}"),
    emit(cwd, result),
  ]);
  return cwd;
}
async function emit(cwd: string, result: unknown) {
  await writeFile(
    join(cwd, "evaluate.mjs"),
    `process.stderr.write("private-profile-child-marker");process.stdout.write(${JSON.stringify(JSON.stringify(result))});`,
  );
}
function capture() {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  return { read: () => output };
}
const command = ["node", "nexpress", "agent", "evaluate"];

describe.each(datasets)("installed CLI profile %s", (dataset) => {
  it("binds the exact suite, budget and captured baseline without trusting child comparisons", async () => {
    const artifact = source(dataset);
    const comparison = await npCompareAgentEvaluationArtifactsV1(artifact, artifact);
    const result = {
      schemaVersion: "np.agent-eval-command.v1",
      artifact,
      comparison,
      errorCode: null,
    };
    const cwd = await project(result);
    await writeFile(join(cwd, "baseline.json"), JSON.stringify(artifact));
    const args = ["--dataset", dataset, "--compare", "baseline.json", "--json"];
    const verify = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(args),
      cwd,
    );
    // The source file is captured before child execution and cannot be replaced by it.
    await writeFile(join(cwd, "baseline.json"), "{}");
    expect(await verify(result)).toEqual(result);
    expect(comparison).toMatchObject({ comparable: true, violationDelta: 0 });
    for (const wrong of [
      null,
      {},
      { ...result, comparison: null },
      { ...result, comparison: { comparable: false, reason: "MODEL_MISMATCH" } },
      { ...result, artifact: { ...artifact, ok: false } },
      { ...result, artifact: { ...artifact, suite: { ...artifact.suite, cases: [] } } },
      { ...result, detail: "private-profile-child-marker" },
    ])
      await expect(verify(wrong)).rejects.toThrow();

    const other = source(dataset === "publisher.v3" ? "moderator-assessment.v1" : "publisher.v3");
    await expect(
      verify({
        ...result,
        artifact: other,
        comparison: await npCompareAgentEvaluationArtifactsV1(other, other),
      }),
    ).rejects.toThrow("Mismatched evaluation result");
    const wrongBudget = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(["--dataset", dataset, "--max-calls", "99"]),
      cwd,
    );
    await expect(wrongBudget({ ...result, comparison: null })).rejects.toThrow(
      "Mismatched evaluation result",
    );
    await expect(
      prepareEvaluationResultVerifier(npParseAgentEvaluationCommandArgsV1(args), cwd),
    ).rejects.toThrow();
  }, 20_000);

  it("binds review source, labels and baseline to the existing App command envelope", async () => {
    const evaluation = source(dataset);
    const empty = await npBuildAgentProfileEvaluationReviewArtifactV1(evaluation);
    const entry = empty.entries.find((value) => value.eligible);
    if (!entry) throw new Error("Missing reviewable prediction.");
    const labels: NpAgentProfileEvaluationReviewLabelV1[] = [
      {
        caseId: entry.caseId,
        caseHash: entry.caseHash,
        predictionHash: entry.predictionHash,
        sourceHash: entry.sourceHash,
        outcome: "accept",
        reviewer: "offline-profile-reviewer",
        reviewedAt: "2026-10-15T00:00:00.000Z",
        notes: "Synthetic conformance only; no approval authority.",
        editedProposal: null,
      },
    ];
    const artifact = await npBuildAgentProfileEvaluationReviewArtifactV1(evaluation, labels);
    const comparison = await npCompareAgentProfileEvaluationReviewArtifactsV1(artifact, artifact);
    const result = {
      schemaVersion: "np.agent-eval-review-command.v1" as const,
      artifact,
      comparison,
      errorCode: null,
    };
    const cwd = await project(result);
    await Promise.all([
      writeFile(join(cwd, "source.json"), JSON.stringify(evaluation)),
      writeFile(join(cwd, "labels.json"), JSON.stringify(labels)),
      writeFile(join(cwd, "baseline.json"), JSON.stringify(artifact)),
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
    await Promise.all([
      writeFile(join(cwd, "source.json"), "{}"),
      writeFile(join(cwd, "labels.json"), "[]"),
      writeFile(join(cwd, "baseline.json"), "{}"),
    ]);
    expect(await verify(result)).toEqual(result);
    expect(formatEvaluationResult(result)).toContain("Self-reported labels confer no approval");
    const { mode, suite, provider, model, budget, caseResults } = evaluation;
    const replacement = await npBuildAgentEvaluationArtifactV1({
      mode,
      suite,
      provider,
      model,
      budget,
      caseResults,
      startedAt: "2026-10-15T01:00:00.000Z",
      finishedAt: "2026-10-15T01:00:01.000Z",
    });
    for (const wrong of [
      {},
      { ...result, artifact: empty },
      {
        ...result,
        artifact: await npBuildAgentProfileEvaluationReviewArtifactV1(replacement),
      },
      { ...result, artifact: { ...artifact, summary: { ...artifact.summary, reviewed: 99 } } },
      { ...result, comparison: null },
      { ...result, comparison: { ...comparison, matchedCaseKeys: [] } },
      { ...result, schemaVersion: "np.agent-profile-eval-review-command.v1" },
      { ...result, detail: "private-profile-child-marker" },
    ])
      await expect(verify(wrong)).rejects.toThrow("Mismatched profile review result");
    for (const errorCode of ["ARTIFACT_INVALID", "ARTIFACT_UNAVAILABLE"] as const) {
      const failure = { ...result, artifact: null, comparison: null, errorCode };
      expect(await verify(failure)).toEqual(failure);
    }
    await expect(
      prepareEvaluationResultVerifier(npParseAgentEvaluationCommandArgsV1(args), cwd),
    ).rejects.toThrow();
  }, 20_000);

  it("passes actual fake child output and profile review through the project CLI without network", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Network forbidden in offline profile verification.");
    });
    vi.stubGlobal("fetch", fetch);
    const evaluation = source(dataset);
    const result = {
      schemaVersion: "np.agent-eval-command.v1",
      artifact: evaluation,
      comparison: null,
      errorCode: null,
    };
    const cwd = await project(result);
    const output = capture();
    expect(await runNexpressCli([...command, "--dataset", dataset, "--json"], { cwd })).toBe(0);
    expect(JSON.parse(output.read())).toEqual(result);
    const artifact = await npBuildAgentProfileEvaluationReviewArtifactV1(evaluation);
    const review = {
      schemaVersion: "np.agent-eval-review-command.v1",
      artifact,
      comparison: null,
      errorCode: null,
    };
    await Promise.all([
      emit(cwd, review),
      writeFile(join(cwd, "source.json"), JSON.stringify(evaluation)),
    ]);
    const reviewOutput = capture();
    expect(await runNexpressCli([...command, "--review", "source.json", "--json"], { cwd })).toBe(
      0,
    );
    expect(JSON.parse(reviewOutput.read())).toEqual(review);
    expect(reviewOutput.read()).not.toContain("private-profile-child-marker");
    expect(fetch).not.toHaveBeenCalled();
  }, 20_000);
});

it("describes both explicit profiles in the installed CLI help", async () => {
  const cwd = await project({});
  const output = capture();
  expect(await runNexpressCli([...command, "--help"], { cwd })).toBe(0);
  expect(output.read()).toContain("moderator-assessment.v1");
  expect(output.read()).toContain("publisher.v3");
  expect(output.read()).toContain("no approval authority");
});
