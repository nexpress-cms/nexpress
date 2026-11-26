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
import { npCreateAgentMemberReportEvaluationSuiteV1 } from "./member-report-evaluation-fixtures.js";
import { runAgentEvaluationV1 } from "./evaluation.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
const offline = { mode: "fake", providerId: "fake", model: "deterministic-v1", budget } as const;
let artifact: NpAgentEvaluationArtifactV1;
beforeAll(async () => {
  const suite = await npCreateAgentMemberReportEvaluationSuiteV1();
  artifact = await runAgentEvaluationV1({ ...offline, suite });
});

it("scores the exact synthetic classifications and response blockers with no predicted actions", async () => {
  expect(artifact).toMatchObject({
    ok: true,
    mode: "fake",
    metrics: { cases: 18, predictedPositive: 3, abstained: 15 },
    usage: { costMicros: 0 },
  });
  expect(new Set(artifact.suite.cases.map((entry) => entry.locale))).toEqual(new Set(["en", "ko"]));
  for (const [index, entry] of artifact.suite.cases.entries()) {
    expect(artifact.caseResults[index].prediction).toMatchObject({
      memberReport: entry.expectedMemberReport,
      actions: [],
    });
  }
  expect(await npRequireAgentEvaluationArtifactV1(artifact)).toEqual(artifact);
});

it("detects altered outcomes and blocks provider access and foreign evidence fields", async () => {
  const { suite, mode, provider, model, budget, startedAt, finishedAt, caseResults } =
    structuredClone(artifact);
  const prediction = caseResults[0].prediction!;
  prediction.decision = "observe";
  prediction.memberReport = {
    classification: "unverified-claim",
    disposition: "blocked",
    reason: "policy-unavailable",
  };
  const rebuilt = await npBuildAgentEvaluationArtifactV1({
    suite,
    mode,
    provider,
    model,
    budget,
    startedAt,
    finishedAt,
    caseResults,
  });
  expect(rebuilt.ok).toBe(false);
  expect(rebuilt.violations.map((violation) => violation.code)).toContain("PROPOSAL_UNJUSTIFIED");
  const comparison = await npCompareAgentEvaluationArtifactsV1(rebuilt, artifact);
  expect(comparison).toMatchObject({
    comparable: true,
    cases: [
      { memberReportChanged: true },
      ...artifact.caseResults.slice(1).map(() => ({ memberReportChanged: false })),
    ],
  });

  const invoke = vi.fn();
  const quote = vi.fn();
  await expect(
    runAgentEvaluationV1({
      suite,
      mode: "provider",
      providerId: "network",
      model,
      budget,
      confirmNetwork: true,
      provider: { id: "network", model, invoke, quote },
    }),
  ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
  expect(quote).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  expect(() =>
    npParseAgentEvaluationCommandArgsV1([
      "--dataset",
      "moderator-member-report.v1",
      "--provider",
      "network",
      "--model",
      "test-model",
      "--max-calls",
      "100",
      "--max-input-tokens",
      "100000",
      "--max-output-tokens",
      "100000",
      "--max-cost-micros",
      "0",
      "--confirm-network",
    ]),
  ).toThrow();
  suite.cases[0].evidence[0].text = suite.cases[0].evidence[0].text.replace(
    '"source":',
    '"approvalId":"private","source":',
  );
  expect(() => npRequireAgentEvaluationSuiteV1(suite)).toThrow();
});

it("round-trips exact prediction reviews through the existing Moderator Workbench", async () => {
  const request = {
    schemaVersion: "np.agent-eval-workbench-request.v1",
    recipe: "moderator-assessment",
    evaluation: artifact,
    review: null,
    baseline: null,
    baselineReview: null,
    labels: null,
  };
  const initial = await npBuildAgentEvaluationWorkbenchV1(request);
  const entry = initial.cases[0];
  expect(entry.allowedOutcomes).toEqual(["accept", "reject"]);
  const label = {
    caseId: entry.caseId,
    caseHash: entry.caseHash,
    predictionHash: entry.predictionHash,
    sourceHash: entry.sourceHash,
    outcome: "accept",
    reviewer: "local-review",
    reviewedAt: "2026-11-25T00:00:00.000Z",
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
      labels: [{ ...label, outcome: "edit", editedProposal: artifact.caseResults[0].prediction }],
    }),
  ).rejects.toThrow();
});
