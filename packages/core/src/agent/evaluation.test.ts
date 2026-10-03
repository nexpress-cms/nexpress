import { describe, expect, it, vi } from "vitest";
import { runAgentEvaluationV1, type NpAgentEvaluationProviderV1 } from "./evaluation.js";
import { npCreateAgentOperatorEvaluationSuiteV1 } from "./operator-evaluation-fixtures.js";
import { npDigestAgentEvaluationValueV1 } from "../agent-contract/evaluation-contract.js";
import type {
  NpAgentEvaluationBudgetV1,
  NpAgentEvaluationPredictionV1,
  NpAgentEvaluationSuiteV1,
} from "../agent-contract/evaluation-contract.js";

const budget: NpAgentEvaluationBudgetV1 = {
  maxCalls: 100,
  maxInputTokens: 10000,
  maxOutputTokens: 10000,
  maxCostMicros: 10000,
  timeoutMs: 1000,
};
async function fixture(count = 2) {
  const suite = await npCreateAgentOperatorEvaluationSuiteV1();
  return { ...suite, cases: suite.cases.slice(0, count) };
}
function providerFor(suite: NpAgentEvaluationSuiteV1) {
  const quote = vi.fn<NpAgentEvaluationProviderV1["quote"]>(() => ({
    inputTokens: 10,
    outputTokens: 10,
    costMicros: 10,
  }));
  const invoke = vi.fn<NpAgentEvaluationProviderV1["invoke"]>((request) => {
    const expected = suite.cases.find((entry) => entry.id === request.case.id)!;
    return Promise.resolve({
      prediction: {
        decision: expected.expectedDecision,
        actions: [],
        rationaleTags: expected.rationaleTags,
      },
      usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
    });
  });
  const provider: NpAgentEvaluationProviderV1 = {
    id: "fixture-provider",
    model: "fixture-model-v1",
    quote,
    invoke,
  };
  return { provider, quote, invoke };
}
function input(suite: NpAgentEvaluationSuiteV1, provider: NpAgentEvaluationProviderV1) {
  return {
    suite,
    mode: "provider" as const,
    providerId: provider.id,
    model: provider.model,
    confirmNetwork: true,
    provider,
    budget,
  };
}
const codes = (value: { violations: Array<{ code: string }> }) =>
  value.violations.map((entry) => entry.code);

describe("bounded Agent evaluation runner", () => {
  it("runs the versioned bilingual Operator suite offline and does not copy its answer key", async () => {
    const suite = await npCreateAgentOperatorEvaluationSuiteV1();
    const artifact = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(artifact.ok).toBe(true);
    expect(artifact.caseResults).toHaveLength(suite.cases.length);
    expect(new Set(suite.cases.map((entry) => entry.locale))).toEqual(new Set(["en", "ko"]));
    const poisoned = structuredClone(suite);
    poisoned.cases[0].expectedDecision =
      poisoned.cases[0].expectedDecision === "ignore" ? "advise" : "ignore";
    const checked = await runAgentEvaluationV1({
      suite: poisoned,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(checked.ok).toBe(false);
    expect(codes(checked)).toContain("DECISION_MISMATCH");
    expect(checked.caseResults[0].prediction).toEqual(artifact.caseResults[0].prediction);
  });

  it("does not diagnose unknown queue counts as normal even when the sample claims completeness", async () => {
    const suite = await fixture(1);
    const entry = suite.cases[0];
    const evidence = entry.evidence[0];
    const facts = {
      paused: false,
      complete: true,
      minimumPendingJobs: 1,
      staleAfterSeconds: 300,
      queues: [{ ready: null, scheduled: 0, active: 0, oldestReadyAgeSeconds: null }],
    };
    evidence.text = JSON.stringify(facts);
    evidence.digest = await npDigestAgentEvaluationValueV1({
      id: evidence.id,
      kind: evidence.kind,
      observedAt: evidence.observedAt,
      text: evidence.text,
    });
    entry.expectedDecision = "observe";
    entry.rationaleTags = ["unknown"];
    const artifact = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(artifact.ok).toBe(true);
    expect(artifact.caseResults[0].prediction).toEqual({
      decision: "observe",
      actions: [],
      rationaleTags: ["unknown"],
    });
  });

  it("returns a failed offline artifact with known zero usage for malformed synthetic facts", async () => {
    const suite = await fixture();
    const evidence = suite.cases[0].evidence[0];
    evidence.text = "{invalid-json";
    evidence.digest = await npDigestAgentEvaluationValueV1({
      id: evidence.id,
      kind: evidence.kind,
      observedAt: evidence.observedAt,
      text: evidence.text,
    });
    const artifact = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(artifact.ok).toBe(false);
    expect(artifact.caseResults[0]).toMatchObject({
      error: "STRUCTURED_OUTPUT_INVALID",
      prediction: null,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    });
    expect(artifact.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, costMicros: 0 });
    expect(artifact.caseResults[1]).toMatchObject({ error: "NOT_RUN", calls: 0 });
  });

  it.each(["worker-dead", "draining"] as const)(
    "fails unsupported %s diagnosis even with the expected decision",
    async (tag) => {
      const suite = await fixture(1);
      const { provider, invoke } = providerFor(suite);
      invoke.mockResolvedValue({
        prediction: {
          decision: suite.cases[0].expectedDecision,
          actions: [],
          rationaleTags: [tag],
        } satisfies NpAgentEvaluationPredictionV1,
        usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
      });
      const artifact = await runAgentEvaluationV1(input(suite, provider));
      expect(artifact.ok).toBe(false);
      expect(codes(artifact)).toContain("DECISION_MISMATCH");
    },
  );

  it("counts an ops.execute proposal as forbidden and never dispatches capabilities", async () => {
    const suite = await fixture(1);
    const { provider, invoke } = providerFor(suite);
    invoke.mockResolvedValue({
      prediction: {
        decision: suite.cases[0].expectedDecision,
        actions: ["ops.execute"],
        rationaleTags: suite.cases[0].rationaleTags,
      },
      usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
    });
    const artifact = await runAgentEvaluationV1(input(suite, provider));
    expect(artifact.ok).toBe(false);
    expect(artifact.metrics.forbiddenActionProposals).toBe(1);
    expect(codes(artifact)).toContain("FORBIDDEN_ACTION_PROPOSED");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(artifact.caseResults[0].prediction?.actions).toEqual(["ops.execute"]);
  });

  it("requires confirmation, bounded budget and exact injected provider identity before callbacks", async () => {
    const suite = await fixture(1);
    const { provider, quote, invoke } = providerFor(suite);
    const configured = input(suite, provider);
    await expect(
      runAgentEvaluationV1({ ...configured, confirmNetwork: false }),
    ).rejects.toMatchObject({ code: "NETWORK_CONFIRMATION_REQUIRED" });
    await expect(
      runAgentEvaluationV1({ ...configured, model: "different-model" }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(
      runAgentEvaluationV1({ ...configured, providerId: "different-provider" }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(
      runAgentEvaluationV1({ ...configured, budget: { ...budget, maxCostMicros: -1 } }),
    ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    expect(quote).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not leak expected decisions, rationale tags or action allowlists into provider requests", async () => {
    const suite = await fixture(1);
    const { provider, invoke, quote } = providerFor(suite);
    const artifact = await runAgentEvaluationV1(input(suite, provider));
    expect(artifact.ok).toBe(true);
    for (const request of [quote.mock.calls[0][0], invoke.mock.calls[0][0]]) {
      expect(Object.keys(request.case).sort()).toEqual(["caseVersion", "evidence", "id", "locale"]);
      expect(JSON.stringify(request.case)).not.toMatch(
        /"(?:expectedDecision|rationaleTags|allowedActions|forbiddenActions|expectedSignals)"\s*:/u,
      );
    }
  });

  it.each(["inputTokens", "outputTokens", "costMicros"] as const)(
    "contains %s worst-case reservation before any network invocation",
    async (field) => {
      const suite = await fixture();
      const { provider, quote, invoke } = providerFor(suite);
      quote.mockReturnValue({ inputTokens: 10, outputTokens: 10, costMicros: 10, [field]: 10001 });
      const artifact = await runAgentEvaluationV1(input(suite, provider));
      expect(artifact.ok).toBe(false);
      expect(codes(artifact)).toContain("BUDGET_EXCEEDED");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("charges known usage and stops before the next call exhausts remaining caps", async () => {
    const suite = await fixture();
    const { provider, invoke } = providerFor(suite);
    const artifact = await runAgentEvaluationV1({
      ...input(suite, provider),
      budget: { ...budget, maxCostMicros: 10 },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(artifact.usage.costMicros).toBe(1);
    expect(codes(artifact)).toContain("BUDGET_EXCEEDED");
  });

  it("reports provider usage beyond its quote and halts subsequent calls", async () => {
    const suite = await fixture();
    const { provider, invoke } = providerFor(suite);
    invoke.mockResolvedValue({
      prediction: { decision: "observe", actions: [], rationaleTags: [] },
      usage: { inputTokens: 11, outputTokens: 1, costMicros: 1 },
    });
    const artifact = await runAgentEvaluationV1(input(suite, provider));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(artifact.usage.inputTokens).toBe(11);
    expect(codes(artifact)).toContain("BUDGET_EXCEEDED");
    expect(artifact.ok).toBe(false);
  });

  it("preserves unknown usage as null and stops instead of budgeting it as zero", async () => {
    const suite = await fixture();
    const { provider, invoke } = providerFor(suite);
    invoke.mockResolvedValue({
      prediction: { decision: "observe", actions: [], rationaleTags: [] },
      usage: null,
    });
    const artifact = await runAgentEvaluationV1(input(suite, provider));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(artifact.usage).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      costMicros: null,
    });
    expect(artifact.ok).toBe(false);
  });

  it("bounds an uncooperative provider by timeout, aborts its signal and never retries", async () => {
    const suite = await fixture();
    const { provider, invoke } = providerFor(suite);
    let signal: AbortSignal | undefined;
    invoke.mockImplementation((_request, context) => {
      signal = context.signal;
      return new Promise(() => {});
    });
    const artifact = await runAgentEvaluationV1({
      ...input(suite, provider),
      budget: { ...budget, timeoutMs: 10 },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(artifact.caseResults.some((entry) => entry.error === "TIMEOUT")).toBe(true);
    expect(artifact.usage.costMicros).toBeNull();
    expect(artifact.ok).toBe(false);
  });

  it("honors an in-flight caller abort without another request", async () => {
    const suite = await fixture();
    const { provider, invoke } = providerFor(suite);
    const controller = new AbortController();
    invoke.mockImplementation(async () => {
      controller.abort();
      return new Promise(() => {});
    });
    const artifact = await runAgentEvaluationV1({
      ...input(suite, provider),
      signal: controller.signal,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(artifact.ok).toBe(false);
    expect(artifact.usage.costMicros).toBeNull();
  });

  it.each(["throw", "malformed"])(
    "redacts %s provider failures and raw model text from artifacts",
    async (mode) => {
      const suite = await fixture(1);
      const { provider, invoke } = providerFor(suite);
      const secret = "Bearer private-provider-secret@example.test";
      if (mode === "throw") invoke.mockRejectedValue(new Error(secret));
      else
        invoke.mockResolvedValue({
          prediction: { text: secret },
          usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
        });
      const artifact = await runAgentEvaluationV1(input(suite, provider));
      expect(artifact.ok).toBe(false);
      expect(JSON.stringify(artifact)).not.toContain(secret);
      expect(artifact.caseResults[0].prediction).toBeNull();
    },
  );
});
