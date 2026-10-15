import { describe, expect, it, vi } from "vitest";
import { runAgentEvaluationV1, type NpAgentEvaluationProviderV1 } from "./evaluation.js";
import {
  npCreateAgentPublisherEvaluationSuiteV1,
  npCreateAgentPublisherEvaluationSuiteV2,
} from "./publisher-evaluation-fixtures.js";
import { npCreateAgentOperatorEvaluationSuiteV1 } from "./operator-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentEvaluationCommandResultV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npCreateAgentPublisherEvaluationPredictionV1,
  npAgentPublisherEvaluationBenchmarkInstructionV2,
} from "../agent-contract/publisher-evaluation-contract.js";
import {
  npCreateAgentPublisherUncertaintyRecipeDefinitionV1,
  npCreateAgentPublisherRecipeDefinitionV1,
} from "../agent-contract/publisher-recipe-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "./provider-auth-contract.js";
import { analyzeAgentCanonicalJsonValue } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100000,
  maxOutputTokens: 100000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
async function evaluate() {
  return runAgentEvaluationV1({
    suite: await npCreateAgentPublisherEvaluationSuiteV1(),
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

describe("Publisher evaluation through the shared runner", () => {
  it("evaluates grounded bilingual proposals offline without reading expected answers", async () => {
    const artifact = await evaluate();
    expect(artifact.ok).toBe(true);
    expect(artifact.caseResults.some((r) => r.prediction?.proposal)).toBe(true);
    expect(artifact.caseResults.some((r) => r.prediction?.proposal === null)).toBe(true);
    expect(new Set(artifact.suite.cases.map((c) => c.locale))).toEqual(new Set(["en", "ko"]));
    const suite = structuredClone(artifact.suite);
    const index = artifact.caseResults.findIndex((r) => r.prediction?.proposal);
    suite.cases[index].expectedDecision = "ignore";
    suite.cases[index].rationaleTags = ["normal"];
    const poisoned = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(poisoned.caseResults[index].prediction).toEqual(artifact.caseResults[index].prediction);
    expect(poisoned.ok).toBe(false);
    expect(poisoned.violations.some((v) => v.code === "DECISION_MISMATCH")).toBe(true);
  });

  it("scores the actual patch, missing proposal and forbidden actions despite matching decision tags", async () => {
    const artifact = await evaluate();
    const index = artifact.caseResults.findIndex((r) => r.prediction?.proposal);
    const absent = source(artifact);
    absent.caseResults[index].prediction!.proposal = null;
    const missing = await npBuildAgentEvaluationArtifactV1(absent);
    expect(missing.ok).toBe(false);
    expect(missing.violations.some((v) => v.code === "PROPOSAL_MISSING")).toBe(true);
    const changed = source(artifact);
    const prediction = changed.caseResults[index].prediction!;
    const operation = prediction.proposal!.draft.operations[0];
    if (operation.kind !== "document" || operation.operation !== "update")
      throw new Error("Expected document update");
    operation.input.patch = { seoDescription: "Fabricated facts with no evidence" };
    prediction.actions = ["changeset.apply", "changeset.create"];
    const invalid = await npBuildAgentEvaluationArtifactV1(changed);
    expect(invalid.violations.map((v) => v.code)).toEqual(
      expect.arrayContaining(["PROPOSAL_CONTENT_INVALID", "FORBIDDEN_ACTION_PROPOSED"]),
    );
    await expect(npRequireAgentEvaluationArtifactV1({ ...invalid, ok: true })).rejects.toThrow();
    const comparison = await npCompareAgentEvaluationArtifactsV1(invalid, artifact);
    expect(comparison).toMatchObject({ comparable: true, currentOk: false, baselineOk: true });
    if (!comparison.comparable) throw new Error("Expected compatible comparison");
    expect(comparison.cases[index].proposalChanged).toBe(true);
    await expect(
      npRequireAgentEvaluationCommandResultV1({
        schemaVersion: "np.agent-eval-command.v1",
        artifact: invalid,
        comparison,
        errorCode: null,
      }),
    ).resolves.toMatchObject({ artifact: { ok: false } });
  });

  it("gives an explicitly injected stub the shipped Publisher instruction and schema, never expected labels", async () => {
    const artifact = await evaluate();
    const recipe = await npCreateAgentPublisherRecipeDefinitionV1();
    const invoke = vi.fn<NpAgentEvaluationProviderV1["invoke"]>((request) => {
      expect(Object.keys(request.case).sort()).toEqual(["caseVersion", "evidence", "id", "locale"]);
      expect(request.instruction).toEqual(recipe.instruction);
      const prediction = artifact.caseResults.find((r) => r.caseId === request.case.id)!.prediction;
      expect(() =>
        npRequireAgentProviderSchemaValueV1(
          request.responseSchema,
          npRequireAgentContractResult(analyzeAgentCanonicalJsonValue(prediction)),
        ),
      ).not.toThrow();
      return Promise.resolve({
        prediction,
        usage: { inputTokens: 1, outputTokens: 1, costMicros: 0 },
      });
    });
    const result = await runAgentEvaluationV1({
      suite: artifact.suite,
      mode: "provider",
      providerId: "local-stub",
      model: "fixture",
      confirmNetwork: true,
      provider: {
        id: "local-stub",
        model: "fixture",
        quote: () => ({ inputTokens: 2, outputTokens: 2, costMicros: 0 }),
        invoke,
      },
      budget,
    });
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(artifact.suite.cases.length);
    expect(await npCompareAgentEvaluationArtifactsV1(result, artifact)).toEqual({
      comparable: false,
      reason: "MODE_MISMATCH",
    });
  });

  it("preserves Operator policy hashes and refuses mixed-category suites", async () => {
    const suite = await npCreateAgentOperatorEvaluationSuiteV1();
    const operator = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(operator).toMatchObject({
      ok: true,
      suiteHash: "cj1:sha256:eCVGJLzpY4z9hmlsD9To1-lxPdXKxRGUcIIdCCFABH4",
      policyHash: "cj1:sha256:jDHVx5rinlOcslRHTNQJQeUceB2yF6nv8JTYsf1YCks",
      gateRulesHash: "cj1:sha256:w7ui2wEFKj7iOzsryaWXmnACqixZDuG8OuHjxu1sH6g",
    });
    const publisher = await npCreateAgentPublisherEvaluationSuiteV1();
    expect(() =>
      npRequireAgentEvaluationSuiteV1({ ...suite, cases: [suite.cases[0], publisher.cases[0]] }),
    ).toThrow();
    expect(operator.caseResults.every((r) => !Object.hasOwn(r.prediction!, "proposal"))).toBe(true);
  });
  it("preserves V1 hashes and every source case while binding V2 dispatch to its explicit profile", async () => {
    const original = await evaluate();
    expect(original).toMatchObject({
      suiteHash: "cj1:sha256:WNL4gtBmc0oMgSzy4JLlyt014xW6R4IXxSp5wFiKzno",
      policyHash: "cj1:sha256:QuZm6wMYqx6PrEfCbG_xasShUTMhlIJzUF-Djg5GF3Y",
      gateRulesHash: "cj1:sha256:S8KzzaU7HFJSicVSEgKyWHBNs-FDZXKmJS_JAQ3jfXg",
    });
    const suite = await npCreateAgentPublisherEvaluationSuiteV2();
    expect(suite.cases.slice(0, 12)).toEqual(original.suite.cases);
    expect(suite.cases).toHaveLength(18);
    const profile = await npCreateAgentPublisherUncertaintyRecipeDefinitionV1();
    const invoke = vi.fn<NpAgentEvaluationProviderV1["invoke"]>((request) => {
      expect(request.instruction).toEqual(profile.instruction);
      expect(request.benchmarkInstruction).toBe(npAgentPublisherEvaluationBenchmarkInstructionV2);
      expect(Object.keys(request.case).sort()).toEqual(["caseVersion", "evidence", "id", "locale"]);
      return Promise.resolve({
        prediction: npCreateAgentPublisherEvaluationPredictionV1(request.case.evidence),
        usage: { inputTokens: 1, outputTokens: 1, costMicros: 0 },
      });
    });
    const artifact = await runAgentEvaluationV1({
      suite,
      mode: "provider",
      providerId: "local-stub",
      model: "fixture",
      confirmNetwork: true,
      provider: {
        id: "local-stub",
        model: "fixture",
        quote: () => ({ inputTokens: 2, outputTokens: 2, costMicros: 0 }),
        invoke,
      },
      budget,
    });
    expect(artifact.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(18);
    expect(artifact.policyHash).not.toBe(original.policyHash);
    expect(artifact.gateRulesHash).toBe(original.gateRulesHash);
    expect(await npRequireAgentEvaluationArtifactV1(artifact)).toEqual(artifact);
    const fake = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(await npCompareAgentEvaluationArtifactsV1(fake, original)).toEqual({
      comparable: false,
      reason: "SUITE_MISMATCH",
    });
    const cases = fake.caseResults.slice(12).map((r) => r.prediction?.decision);
    expect(cases).toEqual(["observe", "observe", "observe", "ignore", "observe", "ignore"]);
    await expect(
      npRequireAgentEvaluationArtifactV1({ ...artifact, policyHash: original.policyHash }),
    ).rejects.toThrow();
  });

  it("keeps a model's uncertain-as-normal error visible rather than repairing its prediction", async () => {
    const artifact = await runAgentEvaluationV1({
      suite: await npCreateAgentPublisherEvaluationSuiteV2(),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    const changed = source(artifact);
    changed.caseResults[3].prediction = {
      decision: "ignore",
      actions: [],
      rationaleTags: ["normal"],
      proposal: null,
    };
    const failed = await npBuildAgentEvaluationArtifactV1(changed);
    expect(failed.ok).toBe(false);
    expect(failed.caseResults[3].prediction).toEqual(changed.caseResults[3].prediction);
    expect(failed.violations).toContainEqual(
      expect.objectContaining({ caseId: "pub-004", code: "DECISION_MISMATCH" }),
    );
  });
});
