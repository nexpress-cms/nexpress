import { describe, expect, it, vi } from "vitest";
import { runAgentEvaluationV1, type NpAgentEvaluationProviderV1 } from "./evaluation.js";
import { npCreateAgentOperatorPlanEvaluationSuiteV1 } from "./operator-plan-evaluation-fixtures.js";
import {
  npAgentEvaluationResponseSchemaV1,
  npBuildAgentEvaluationArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npRequireAgentEvaluationArtifactV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentEvaluationPredictionV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npAgentOperatorPlanEvaluationBenchmarkInstructionV1,
  npCreateAgentOperatorPlanEvaluationPredictionV1,
} from "../agent-contract/operator-plan-evaluation-contract.js";
import { npCreateAgentOperatorRecipeDefinitionV1 } from "../agent-contract/operator-recipe-contract.js";
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
async function evaluate() {
  return runAgentEvaluationV1({
    suite: await npCreateAgentOperatorPlanEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
}
function source(a: NpAgentEvaluationArtifactV1) {
  return {
    mode: a.mode,
    suite: a.suite,
    provider: a.provider,
    model: a.model,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    budget: a.budget,
    caseResults: structuredClone(a.caseResults),
  };
}

describe("Operator diagnosis and plan proposals through the shared evaluator", () => {
  it("grounds all 16 bilingual cases independently of poisoned expected answers", async () => {
    const artifact = await evaluate();
    expect(artifact.ok).toBe(true);
    expect(artifact.caseResults).toHaveLength(16);
    expect(new Set(artifact.suite.cases.map((c) => c.locale))).toEqual(new Set(["en", "ko"]));
    expect(artifact.caseResults.every((r) => r.prediction?.planProposal)).toBe(true);
    expect(artifact.caseResults.filter((r) => r.prediction?.planProposal?.plan)).toHaveLength(3);
    expect(artifact.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, costMicros: 0 });
    const suite = structuredClone(artifact.suite);
    suite.cases[8].expectedDecision = "ignore";
    suite.cases[8].rationaleTags = ["normal"];
    suite.cases[8].allowedActions = [];
    const poisoned = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(poisoned.caseResults.map((r) => r.prediction)).toEqual(
      artifact.caseResults.map((r) => r.prediction),
    );
    expect(poisoned.ok).toBe(false);
    expect(poisoned.violations.map((v) => v.code)).toEqual(
      expect.arrayContaining(["DECISION_MISMATCH", "POLICY_BYPASS"]),
    );
  });

  it("passes only observations, shipped instruction and the plan schema to an explicitly injected local stub", async () => {
    const recipe = await npCreateAgentOperatorRecipeDefinitionV1();
    const quote = vi.fn<NpAgentEvaluationProviderV1["quote"]>(() => ({
      inputTokens: 2,
      outputTokens: 2,
      costMicros: 0,
    }));
    const invoke = vi.fn<NpAgentEvaluationProviderV1["invoke"]>((request) => {
      expect(request.instruction).toEqual(recipe.instruction);
      expect(request.benchmarkInstruction).toBe(
        npAgentOperatorPlanEvaluationBenchmarkInstructionV1,
      );
      expect(request.responseSchema).toEqual(npAgentEvaluationResponseSchemaV1("ops-plan"));
      const prediction = npCreateAgentOperatorPlanEvaluationPredictionV1(request.case.evidence);
      npRequireAgentProviderSchemaValueV1(
        request.responseSchema,
        npRequireAgentContractResult(analyzeAgentCanonicalJsonValue(prediction)),
      );
      return Promise.resolve({
        prediction,
        usage: { inputTokens: 1, outputTokens: 1, costMicros: 0 },
      });
    });
    const artifact = await runAgentEvaluationV1({
      suite: await npCreateAgentOperatorPlanEvaluationSuiteV1(),
      mode: "provider",
      providerId: "local-stub",
      model: "fixture",
      confirmNetwork: true,
      provider: { id: "local-stub", model: "fixture", quote, invoke },
      budget,
    });
    expect(artifact.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(16);
    expect(quote).toHaveBeenCalledTimes(16);
    for (const [request] of [...quote.mock.calls, ...invoke.mock.calls]) {
      expect(Object.keys(request.case).sort()).toEqual(["caseVersion", "evidence", "id", "locale"]);
      expect(JSON.stringify(request.case)).not.toMatch(
        /"(?:expectedDecision|rationaleTags|allowedActions|forbiddenActions|expectedSignals)"\s*:/u,
      );
    }
  });

  it("fails actual ungrounded diagnosis and plan inputs even when all expected decision tags match", async () => {
    const artifact = await evaluate();
    const mutations: Array<(p: NpAgentEvaluationPredictionV1) => void> = [
      (p) => {
        if (p.planProposal)
          p.planProposal.diagnosis.summary =
            "A dead worker was proven and staff approved execution.";
      },
      (p) => {
        if (p.planProposal) p.planProposal.diagnosis.queueNames = ["unrelated"];
      },
      (p) => {
        if (p.planProposal)
          p.planProposal.plan = {
            action: "queue.global.plan",
            target: { kind: "queue", operation: "drain", jobName: "unrelated" },
          };
      },
      (p) => {
        if (p.planProposal)
          p.planProposal.plan = { action: "cache.revalidate", target: { kind: "site" } };
      },
    ];
    for (const mutate of mutations) {
      const changed = source(artifact);
      const prediction = changed.caseResults[8].prediction;
      if (!prediction) throw new Error("Expected plan prediction");
      mutate(prediction);
      const invalid = await npBuildAgentEvaluationArtifactV1(changed);
      expect(invalid.ok).toBe(false);
      expect(invalid.violations.map((v) => v.code)).toContain("PROPOSAL_CONTENT_INVALID");
      expect(invalid.violations.map((v) => v.code)).not.toContain("DECISION_MISMATCH");
      await expect(npRequireAgentEvaluationArtifactV1({ ...invalid, ok: true })).rejects.toThrow();
      const comparison = await npCompareAgentEvaluationArtifactsV1(invalid, artifact);
      expect(comparison).toMatchObject({ comparable: true, currentOk: false, baselineOk: true });
      if (!comparison.comparable) throw new Error("Expected compatible comparison");
      expect(comparison.cases[8].planProposalChanged).toBe(true);
    }
  });

  it("requires proposal/action agreement and never treats a valid ops.plan input as execution permission", async () => {
    const artifact = await evaluate();
    for (const actions of [
      [],
      ["ops.execute"],
      ["ops.execute", "ops.plan"],
    ] satisfies NpAgentEvaluationPredictionV1["actions"][]) {
      const changed = source(artifact);
      const p = changed.caseResults[8].prediction;
      if (!p) throw new Error("Expected plan prediction");
      p.actions = actions;
      const invalid = await npBuildAgentEvaluationArtifactV1(changed);
      expect(invalid.ok).toBe(false);
      if (!actions.includes("ops.plan"))
        expect(invalid.violations.map((v) => v.code)).toContain("PROPOSAL_UNJUSTIFIED");
      if (actions.includes("ops.execute"))
        expect(invalid.violations.map((v) => v.code)).toContain("FORBIDDEN_ACTION_PROPOSED");
    }
    const changed = source(artifact);
    const p = changed.caseResults[0].prediction;
    if (!p) throw new Error("Expected diagnosis prediction");
    p.planProposal = null;
    const missing = await npBuildAgentEvaluationArtifactV1(changed);
    expect(missing.violations.map((v) => v.code)).toContain("PROPOSAL_MISSING");
  });
});
