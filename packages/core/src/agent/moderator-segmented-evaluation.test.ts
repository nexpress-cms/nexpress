import { beforeAll, expect, it, vi } from "vitest";
import {
  npBuildAgentEvaluationArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import { npParseAgentEvaluationCommandArgsV1 } from "../agent-contract/evaluation-command-contract.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import { npCreateAgentModeratorAssessmentEvaluationSuiteV1 } from "./moderator-assessment-evaluation-fixtures.js";
import { npCreateAgentModeratorSegmentedEvaluationSuiteV2 } from "./moderator-segmented-evaluation-fixtures.js";
import { runAgentEvaluationV1 } from "./evaluation.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
const fake = { mode: "fake", providerId: "fake", model: "deterministic-v1", budget } as const;
let evaluation: NpAgentEvaluationArtifactV1;
beforeAll(async () => {
  evaluation = await runAgentEvaluationV1({
    ...fake,
    suite: await npCreateAgentModeratorSegmentedEvaluationSuiteV2(),
  });
});

it("checks segment coverage independently of classification across the exact synthetic corpus", async () => {
  expect(evaluation).toMatchObject({ ok: true, metrics: { cases: 13 }, usage: { costMicros: 0 } });
  for (const [index, entry] of evaluation.suite.cases.entries()) {
    expect(evaluation.caseResults[index].prediction, entry.id).toMatchObject({
      actions: [],
      segmentedAssessment: entry.expectedSegmentedAssessment,
    });
  }
  expect(await npRequireAgentEvaluationArtifactV1(evaluation)).toEqual(evaluation);
});

it("detects a changed assessment with the same generic decision and rejects provider mode", async () => {
  const { suite, mode, provider, model, budget, startedAt, finishedAt, caseResults } =
    structuredClone(evaluation);
  const pending = caseResults.find((result) => result.caseId === "missing-tail")?.prediction;
  if (!pending?.segmentedAssessment) throw new Error("Missing partial fixture");
  pending.segmentedAssessment.state = "invalid-segments";
  const altered = await npBuildAgentEvaluationArtifactV1({
    suite,
    mode,
    provider,
    model,
    budget,
    startedAt,
    finishedAt,
    caseResults,
  });
  expect(altered.ok).toBe(false);
  expect(altered.violations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ caseId: "missing-tail", code: "PROPOSAL_UNJUSTIFIED" }),
    ]),
  );
  const compared = await npCompareAgentEvaluationArtifactsV1(altered, evaluation);
  expect(compared).toMatchObject({
    comparable: true,
    cases: expect.arrayContaining([
      expect.objectContaining({
        caseId: "missing-tail",
        currentDecision: "observe",
        baselineDecision: "observe",
        segmentedAssessmentChanged: true,
      }),
    ]),
  });

  const adapter = { id: "network", model, quote: vi.fn(), invoke: vi.fn() };
  await expect(
    runAgentEvaluationV1({
      mode: "provider",
      suite,
      budget,
      providerId: "network",
      model,
      provider: adapter,
      confirmNetwork: true,
    }),
  ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
  expect(adapter.quote).not.toHaveBeenCalled();
  expect(adapter.invoke).not.toHaveBeenCalled();
  expect(() =>
    npParseAgentEvaluationCommandArgsV1([
      "--dataset",
      "moderator-assessment.v2",
      "--provider",
      "network",
      "--model",
      "fixture",
      "--max-calls",
      "100",
      "--max-input-tokens",
      "10000",
      "--max-output-tokens",
      "10000",
      "--max-cost-micros",
      "0",
      "--confirm-network",
    ]),
  ).toThrow();
});

it("imports and reviews V2 within the existing Workbench while rejecting a V1 baseline comparison", async () => {
  const v1 = await npCreateAgentModeratorAssessmentEvaluationSuiteV1();
  const baseline = await runAgentEvaluationV1({
    ...fake,
    suite: { ...v1, cases: v1.cases.slice(0, 1) },
  });
  const suite = npRequireAgentEvaluationSuiteV1({
    ...evaluation.suite,
    cases: evaluation.suite.cases.filter((entry) =>
      ["complete-disagreement", "missing-tail"].includes(entry.id),
    ),
  });
  const source = await runAgentEvaluationV1({ ...fake, suite });
  const request = {
    schemaVersion: "np.agent-eval-workbench-request.v1",
    recipe: "moderator-assessment",
    evaluation: source,
    review: null,
    baseline,
    baselineReview: null,
    labels: null,
  };
  const initial = await npBuildAgentEvaluationWorkbenchV1(request);
  expect(initial.summaryText).toContain("SUITE_MISMATCH");
  const entry = initial.cases[0];
  expect(entry.allowedOutcomes).toEqual(["accept", "reject"]);
  const label = {
    caseId: entry.caseId,
    caseHash: entry.caseHash,
    predictionHash: entry.predictionHash,
    sourceHash: entry.sourceHash,
    outcome: "accept",
    reviewer: "offline-reviewer",
    reviewedAt: "2026-11-26T00:00:00.000Z",
    notes: "",
    editedProposal: null,
  };
  const reviewed = await npBuildAgentEvaluationWorkbenchV1({ ...request, labels: [label] });
  const imported = await npBuildAgentEvaluationWorkbenchV1({
    ...request,
    review: JSON.parse(reviewed.reviewArtifactJson!),
  });
  expect(imported).toMatchObject({
    authority: "offline-self-reported-no-approval",
    labelsJson: reviewed.labelsJson,
  });
  await expect(
    npBuildAgentEvaluationWorkbenchV1({
      ...request,
      labels: [{ ...label, outcome: "edit", editedProposal: source.caseResults[0].prediction }],
    }),
  ).rejects.toThrow();
});
