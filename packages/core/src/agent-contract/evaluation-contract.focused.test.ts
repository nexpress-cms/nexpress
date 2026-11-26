import { npParseAgentEvaluationCommandArgsV1 } from "./evaluation-command-contract.js";
import { describe, expect, it } from "vitest";
import { npCreateAgentOperatorEvaluationSuiteV1 } from "../agent/operator-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npDigestAgentEvaluationCaseV1,
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentEvaluationSuiteV1,
  npRequireAgentEvaluationPredictionV1,
  npCompareAgentEvaluationArtifactsV1,
  npRequireAgentEvaluationCommandResultV1,
  type NpAgentEvaluationArtifactInputV1,
} from "./evaluation-contract.js";
async function input(): Promise<NpAgentEvaluationArtifactInputV1> {
  const suite = await npCreateAgentOperatorEvaluationSuiteV1();
  return {
    mode: "fake",
    suite,
    provider: "fake",
    model: "deterministic-v1",
    startedAt: "2026-10-03T00:00:00.000Z",
    finishedAt: "2026-10-03T00:00:01.000Z",
    budget: {
      maxCalls: 8,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostMicros: 0,
      timeoutMs: 1000,
    },
    caseResults: await Promise.all(
      suite.cases.map(async (c) => ({
        caseId: c.id,
        caseVersion: c.caseVersion,
        caseHash: await npDigestAgentEvaluationCaseV1(c),
        prediction: {
          decision: c.expectedDecision,
          actions: [...c.allowedActions],
          rationaleTags: [...c.rationaleTags],
        },
        error: null,
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        latencyMs: 10,
      })),
    ),
  };
}
describe("bounded Operator evaluation contract", () => {
  it("requires explicit network dataset and bounds budgets in the shared parser", () => {
    expect(npParseAgentEvaluationCommandArgsV1(["--", "--provider", "fake"])).toMatchObject({
      provider: "fake",
      model: "deterministic-v1",
      dataset: "operator.v1",
    });
    expect(() => npParseAgentEvaluationCommandArgsV1(["--max-calls", "101"])).toThrow();
    const args = [
      "--provider",
      "test-provider",
      "--model",
      "pinned-model",
      "--confirm-network",
      "--max-calls",
      "1",
      "--max-input-tokens",
      "100",
      "--max-output-tokens",
      "100",
      "--max-cost-micros",
      "5",
    ];
    expect(() => npParseAgentEvaluationCommandArgsV1(args)).toThrow();
    expect(
      npParseAgentEvaluationCommandArgsV1([...args, "--dataset", "operator.v1"]),
    ).toMatchObject({ confirmNetwork: true, maxCalls: 1 });
  });
  it("derives failed decisions and forbidden proposals, and rejects tampered success or metrics", async () => {
    const source = await input();
    source.caseResults[0].prediction = {
      decision: "advise",
      actions: ["ops.execute"],
      rationaleTags: ["worker-dead"],
    };
    const artifact = await npBuildAgentEvaluationArtifactV1(source);
    expect(artifact.ok).toBe(false);
    expect(artifact.metrics.falsePositive).toBe(1);
    expect(artifact.metrics.forbiddenActionProposals).toBe(1);
    await expect(npRequireAgentEvaluationArtifactV1({ ...artifact, ok: true })).rejects.toThrow();
    await expect(
      npRequireAgentEvaluationArtifactV1({
        ...artifact,
        metrics: { ...artifact.metrics, falsePositive: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      npRequireAgentEvaluationArtifactV1({ ...artifact, violations: [] }),
    ).rejects.toThrow();
  });
  it("rejects fabricated success without a call and predictions attached to errors", async () => {
    const source = await input();
    source.caseResults[0].calls = 0;
    source.caseResults[0].latencyMs = 0;
    await expect(npBuildAgentEvaluationArtifactV1(source)).rejects.toThrow();
    source.caseResults[0].calls = 1;
    source.caseResults[0].error = "PROVIDER_ERROR";
    await expect(npBuildAgentEvaluationArtifactV1(source)).rejects.toThrow();
  });
  it("binds evidence and expected labels instead of accepting an opaque case hash", async () => {
    const source = await input();
    source.suite.cases[0].evidence[0].text = "changed evidence";
    await expect(npBuildAgentEvaluationArtifactV1(source)).rejects.toThrow();
    source.caseResults[0].caseHash = await npDigestAgentEvaluationCaseV1(source.suite.cases[0]);
    await expect(npBuildAgentEvaluationArtifactV1(source)).rejects.toThrow();
  });
  it("preserves unknown provider cost and disallows fabricated zero usage for skipped calls", async () => {
    const source = await input();
    source.mode = "provider";
    source.provider = "test-provider";
    source.caseResults[0].costMicros = null;
    source.caseResults[0].error = "USAGE_UNAVAILABLE";
    source.caseResults[0].prediction = null;
    const result = await npBuildAgentEvaluationArtifactV1(source);
    expect(result.usage.costMicros).toBeNull();
    expect(result.metrics.meanCostMicros).toBeNull();
    expect(result.ok).toBe(false);
    source.caseResults[0].error = "NOT_RUN";
    await expect(npBuildAgentEvaluationArtifactV1(source)).rejects.toThrow();
  });
  it("rejects unsupported detectors, malformed bounds and duplicate case identity", async () => {
    const source = await input();
    expect(() =>
      npRequireAgentEvaluationSuiteV1({
        ...source.suite,
        cases: [source.suite.cases[0], source.suite.cases[0]],
      }),
    ).toThrow();
    const invalid = structuredClone(source.suite);
    Reflect.set(invalid.cases[0], "expectedSignals", [{ detectorId: "invented" }]);
    expect(() => npRequireAgentEvaluationSuiteV1(invalid)).toThrow();
    expect(() =>
      npRequireAgentEvaluationPredictionV1({
        decision: "ignore",
        actions: [],
        rationaleTags: ["arbitrary"],
      }),
    ).toThrow();
  });
  it("compares equivalent gates and refuses scoring fake against provider", async () => {
    const source = await input(),
      baseline = await npBuildAgentEvaluationArtifactV1(source);
    expect(await npCompareAgentEvaluationArtifactsV1(baseline, baseline)).toMatchObject({
      comparable: true,
      violationDelta: 0,
      callsDelta: 0,
    });
    await expect(
      npBuildAgentEvaluationArtifactV1({ ...source, mode: "provider" }),
    ).rejects.toThrow();
    const provider = await npBuildAgentEvaluationArtifactV1({
      ...source,
      mode: "provider",
      provider: "test-provider",
    });
    expect(await npCompareAgentEvaluationArtifactsV1(provider, baseline)).toEqual({
      comparable: false,
      reason: "MODE_MISMATCH",
    });
    const changedModel = await npBuildAgentEvaluationArtifactV1({
      ...source,
      mode: "provider",
      provider: "test-provider",
      model: "other-model",
    });
    expect(await npCompareAgentEvaluationArtifactsV1(changedModel, provider)).toEqual({
      comparable: false,
      reason: "MODEL_MISMATCH",
    });
    const changedProvider = await npBuildAgentEvaluationArtifactV1({
      ...source,
      mode: "provider",
      provider: "other-provider",
    });
    expect(await npCompareAgentEvaluationArtifactsV1(changedProvider, provider)).toEqual({
      comparable: false,
      reason: "PROVIDER_MISMATCH",
    });
    await expect(
      npRequireAgentEvaluationCommandResultV1({
        schemaVersion: "np.agent-eval-command.v1",
        artifact: baseline,
        comparison: null,
        errorCode: "ARTIFACT_INVALID",
      }),
    ).rejects.toThrow();
  });
});
