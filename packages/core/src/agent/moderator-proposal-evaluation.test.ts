import { beforeAll, describe, expect, it, vi } from "vitest";
import { runAgentEvaluationV1, type NpAgentEvaluationProviderV1 } from "./evaluation.js";
import { npCreateAgentModeratorProposalEvaluationSuiteV1 } from "./moderator-proposal-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npRequireAgentEvaluationArtifactV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npCreateAgentModeratorProposalEvaluationPredictionV1,
  npRequireAgentModeratorEvaluationResponseV1,
  npRequireAgentModeratorProposalEvaluationEvidenceV1,
  npAgentModeratorProposalEvaluationBenchmarkInstructionV1,
} from "../agent-contract/moderator-proposal-evaluation-contract.js";
import { npCreateAgentModeratorRecipeDefinitionV1 } from "../agent-contract/moderator-recipe-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "./provider-auth-contract.js";
import { analyzeAgentCanonicalJsonValue } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";
const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
let artifact: NpAgentEvaluationArtifactV1;
beforeAll(async () => {
  artifact = await runAgentEvaluationV1({
    suite: await npCreateAgentModeratorProposalEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
});
function source() {
  const { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults } =
    structuredClone(artifact);
  return { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults };
}
describe("Moderator proposal grounding through shared evaluation", () => {
  it("covers bilingual selection and abstention independently of poisoned expected answers", async () => {
    expect(artifact.ok).toBe(true);
    expect(artifact.metrics).toMatchObject({
      cases: 16,
      predictedPositive: 6,
      abstained: 10,
      falsePositive: 0,
      falseNegative: 0,
    });
    expect(artifact.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, costMicros: 0 });
    expect(artifact.suite.cases.filter((c) => c.locale === "ko")).toHaveLength(8);
    const suite = structuredClone(artifact.suite);
    suite.cases[0].expectedDecision = "observe";
    suite.cases[0].allowedActions = [];
    const rerun = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(rerun.caseResults.map((r) => r.prediction)).toEqual(
      artifact.caseResults.map((r) => r.prediction),
    );
    expect(rerun.ok).toBe(false);
    expect(rerun.violations.map((v) => v.code)).toEqual(
      expect.arrayContaining(["DECISION_MISMATCH", "POLICY_BYPASS"]),
    );
    expect(await npRequireAgentEvaluationArtifactV1(artifact)).toEqual(artifact);
  });
  it("uses actual recipe instruction/schema and hides expected answers from an injected local stub", async () => {
    const recipe = await npCreateAgentModeratorRecipeDefinitionV1();
    const invoke = vi.fn<NpAgentEvaluationProviderV1["invoke"]>((request) => {
      expect(request.instruction).toEqual(recipe.instruction);
      expect(request.responseSchema).toEqual(recipe.responseSchema);
      expect(request.benchmarkInstruction).toBe(
        npAgentModeratorProposalEvaluationBenchmarkInstructionV1,
      );
      expect(Object.keys(request.case).sort()).toEqual(["caseVersion", "evidence", "id", "locale"]);
      const response = npCreateAgentModeratorProposalEvaluationPredictionV1(
        request.case.evidence,
      ).moderatorResponse;
      npRequireAgentProviderSchemaValueV1(
        request.responseSchema,
        npRequireAgentContractResult(analyzeAgentCanonicalJsonValue(response)),
      );
      return Promise.resolve({
        prediction: response,
        usage: { inputTokens: 1, outputTokens: 1, costMicros: 0 },
      });
    });
    const result = await runAgentEvaluationV1({
      suite: artifact.suite,
      mode: "provider",
      providerId: "local-stub",
      model: "fixture",
      budget,
      confirmNetwork: true,
      provider: {
        id: "local-stub",
        model: "fixture",
        quote: () => ({ inputTokens: 2, outputTokens: 2, costMicros: 0 }),
        invoke,
      },
    });
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(16);
  });
  it("keeps response text validation aligned with the shipped schema instead of scoring prose", async () => {
    const recipe = await npCreateAgentModeratorRecipeDefinitionV1();
    for (const summary of [" ", "\u0000", "a".repeat(2000)]) {
      const response = { task: "interactive-capability", decision: { kind: "complete", summary } };
      npRequireAgentProviderSchemaValueV1(
        recipe.responseSchema,
        npRequireAgentContractResult(analyzeAgentCanonicalJsonValue(response)),
      );
      expect(npRequireAgentModeratorEvaluationResponseV1(response)).toEqual(response);
    }
    for (const summary of ["", "a".repeat(2001)])
      expect(() =>
        npRequireAgentModeratorEvaluationResponseV1({
          task: "interactive-capability",
          decision: { kind: "complete", summary },
        }),
      ).toThrow();
  });
  it("rejects invented target, Incident, version or reason despite matching tags and reports exact response changes", async () => {
    for (const field of ["target", "incidentId", "expectedVersionDigest", "reasonCode"] as const) {
      const input = source();
      const response = input.caseResults[0].prediction?.moderatorResponse;
      if (response?.decision.kind !== "propose-capability") throw new Error("Expected proposal");
      const p = response.decision.arguments.proposal;
      if (field === "target") p.target.id = "00000000-0000-4000-8000-000000000999";
      if (field === "incidentId") p.incidentId = "00000000-0000-4000-8000-000000000999";
      if (field === "expectedVersionDigest")
        p.expectedVersionDigest = `cj1:sha256:${"a".repeat(43)}`;
      if (field === "reasonCode") p.reasonCode = "OTHER_REASON";
      const changed = await npBuildAgentEvaluationArtifactV1(input);
      expect(changed.ok).toBe(false);
      expect(changed.violations.map((v) => v.code)).toContain("PROPOSAL_EVIDENCE_INVALID");
      expect(changed.violations.map((v) => v.code)).not.toContain("DECISION_MISMATCH");
      await expect(npRequireAgentEvaluationArtifactV1({ ...changed, ok: true })).rejects.toThrow();
      const comparison = await npCompareAgentEvaluationArtifactsV1(changed, artifact);
      if (!comparison.comparable) throw new Error("Expected comparison");
      expect(comparison.cases[0].moderatorResponseChanged).toBe(true);
    }
  });
  it("accepts either admitted candidate but refuses stale, truncated, unavailable proposals and forged action summaries", async () => {
    const input = source();
    const second = npRequireAgentModeratorProposalEvaluationEvidenceV1(
      input.suite.cases[1].evidence,
    ).snapshot?.candidates[1];
    const response = input.caseResults[1].prediction?.moderatorResponse;
    if (!second || response?.decision.kind !== "propose-capability")
      throw new Error("Expected candidates");
    response.decision.arguments.proposal = second.proposal;
    expect((await npBuildAgentEvaluationArtifactV1(input)).ok).toBe(true);
    for (const index of [4, 5, 6, 7]) {
      const changed = source();
      changed.caseResults[index].prediction = npCreateAgentModeratorProposalEvaluationPredictionV1(
        changed.suite.cases[index].evidence,
        changed.caseResults[0].prediction?.moderatorResponse,
      );
      const rejected = await npBuildAgentEvaluationArtifactV1(changed);
      expect(rejected.violations.map((v) => v.code)).toContain("PROPOSAL_UNJUSTIFIED");
      expect(rejected.ok).toBe(false);
    }
    const changed = source();
    const prediction = changed.caseResults[0].prediction;
    if (!prediction) throw new Error("Expected prediction");
    prediction.actions = [];
    expect(
      (await npBuildAgentEvaluationArtifactV1(changed)).violations.map((v) => v.code),
    ).toContain("PROPOSAL_UNJUSTIFIED");
  });
  it("refuses execution, restore, extra keys and missing provider output without a partial prediction", async () => {
    const response = artifact.caseResults[0].prediction?.moderatorResponse;
    if (response?.decision.kind !== "propose-capability") throw new Error("Expected proposal");
    const invalid: unknown[] = [
      null,
      undefined,
      { ...response, unexpected: true },
      { ...response, decision: { ...response.decision, capabilityId: "moderation.restore" } },
      {
        ...response,
        decision: {
          ...response.decision,
          arguments: {
            mode: "execute_approved",
            actionId: "invented",
            approvalId: "invented",
            proposalHash: "invented",
          },
        },
      },
      { task: "interactive-capability", decision: { kind: "execute-capability" } },
    ];
    for (const value of invalid) {
      expect(() => npRequireAgentModeratorEvaluationResponseV1(value)).toThrow();
      expect(() =>
        npCreateAgentModeratorProposalEvaluationPredictionV1(
          artifact.suite.cases[0].evidence,
          value,
        ),
      ).toThrow();
    }
    const result = await runAgentEvaluationV1({
      suite: { ...artifact.suite, cases: [artifact.suite.cases[0]] },
      mode: "provider",
      providerId: "local-stub",
      model: "fixture",
      budget,
      confirmNetwork: true,
      provider: {
        id: "local-stub",
        model: "fixture",
        quote: () => ({ inputTokens: 0, outputTokens: 0, costMicros: 0 }),
        invoke: () =>
          Promise.resolve({
            prediction: null,
            usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
          }),
      },
    });
    expect(result.caseResults[0]).toMatchObject({
      error: "STRUCTURED_OUTPUT_INVALID",
      prediction: null,
    });
    expect(result.ok).toBe(false);
  });
});
