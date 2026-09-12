import { describe, expect, it } from "vitest";
import {
  npRequireAgentProviderResponseCanonical,
  npDigestAgentProviderResponseCanonical,
} from "../agent-contract/canonical-provider.js";
import { providerRequest, providerSuccess } from "./provider-inference-fixture.js";
import {
  npRequireAgentRuntimeProviderDecisionV1,
  npRequireAgentRuntimeProviderFailureReceiptV1,
} from "./runtime-provider-evidence.js";

async function fixture() {
  const request = providerRequest();
  const outcome = providerSuccess();
  if (outcome.status !== "succeeded") throw new Error("Invalid fixture");
  const response = npRequireAgentProviderResponseCanonical({
    schemaVersion: "np.agent-provider-response.v1",
    siteId: request.siteId,
    providerCallId: request.providerCallId,
    runId: request.runId,
    requestDigest: request.instruction.digest,
    dispatchState: "dispatched",
    outcome,
    decision: structuredClone(outcome.output),
    observedAt: "2026-09-12T00:00:00.000Z",
  });
  return {
    state: "succeeded",
    dispatchState: "dispatched",
    decision: response.decision,
    finishedAt: new Date(response.observedAt),
    responseDigest: await npDigestAgentProviderResponseCanonical(response),
    siteId: response.siteId,
    id: response.providerCallId,
    runId: response.runId,
    requestDigest: response.requestDigest,
    provider: outcome.provider,
    model: outcome.model,
    providerRequestId: outcome.providerRequestId,
    inputTokens: outcome.usage.inputTokens,
    cachedInputTokens: outcome.usage.cachedInputTokens,
    outputTokens: outcome.usage.outputTokens,
    usageSource: outcome.usage.tokenSource,
    costMicros: outcome.usage.costMicros,
    costSource: outcome.usage.costSource,
    finishReason: outcome.finishReason,
    latencyMs: outcome.latencyMs,
  };
}
describe("retained runtime provider decision", () => {
  it("reconstructs the exact immutable success receipt", async () => {
    const call = await fixture();
    expect(await npRequireAgentRuntimeProviderDecisionV1(call)).toEqual(call.decision);
  });
  it.each(["decision", "site", "usage", "observedAt", "unknown"])(
    "rejects altered %s evidence",
    async (field) => {
      const call = await fixture();
      if (field === "decision")
        call.decision = {
          task: "interactive-capability",
          decision: { kind: "complete", summary: "Changed" },
        };
      if (field === "site") call.siteId = "another-site";
      if (field === "usage") call.costMicros++;
      if (field === "observedAt") call.finishedAt = new Date(call.finishedAt.getTime() + 1);
      if (field === "unknown") call.state = "ambiguous";
      await expect(npRequireAgentRuntimeProviderDecisionV1(call)).rejects.toMatchObject({
        code: "RUNTIME_PROVIDER_EVIDENCE_INVALID",
      });
    },
  );
});

async function failureFixture(cancelled = false) {
  const request = providerRequest();
  const safeCode = cancelled ? "PROVIDER_CANCELLED" : "PROVIDER_TIMEOUT";
  const response = npRequireAgentProviderResponseCanonical({
    schemaVersion: "np.agent-provider-response.v1",
    siteId: request.siteId,
    providerCallId: request.providerCallId,
    runId: request.runId,
    requestDigest: request.instruction.digest,
    dispatchState: "not-dispatched",
    outcome: {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "failed",
      provider: request.provider,
      model: request.model,
      providerRequestId: null,
      output: null,
      errorClass: cancelled ? "cancelled" : "timeout",
      safeCode,
      retryable: false,
      dispatchState: "not-dispatched",
      usage: null,
      finishReason: null,
      latencyMs: 1,
    },
    decision: null,
    observedAt: "2026-09-12T00:00:00.000Z",
  });
  if (response.outcome.status !== "failed") throw new Error("Invalid fixture");
  const call: Parameters<typeof npRequireAgentRuntimeProviderFailureReceiptV1>[0] = {
    state: cancelled ? "cancelled" : "failed",
    dispatchState: response.dispatchState,
    decision: null,
    finishedAt: new Date(response.observedAt),
    responseDigest: await npDigestAgentProviderResponseCanonical(response),
    siteId: response.siteId,
    id: response.providerCallId,
    runId: response.runId,
    requestDigest: response.requestDigest,
    provider: response.outcome.provider,
    model: response.outcome.model,
    providerRequestId: null,
    errorClass: response.outcome.errorClass,
    retryable: false,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    usageSource: null,
    costMicros: null,
    costSource: null,
    costCurrency: null,
    finishReason: null,
    latencyMs: 1,
    usageReservationId: "00000000-0000-4000-8000-000000000001",
  };
  return { call, safeCode, outcome: response.outcome };
}
describe("retained runtime provider failure", () => {
  it.each([false, true])(
    "reconstructs exact failure/cancellation receipt (%s)",
    async (cancelled) => {
      const f = await failureFixture(cancelled);
      expect(await npRequireAgentRuntimeProviderFailureReceiptV1(f.call, f.safeCode)).toEqual(
        f.outcome,
      );
    },
  );
  it.each([
    "retryable",
    "errorClass",
    "dispatchState",
    "observedAt",
    "safeCode",
    "missingSafeCode",
  ])("rejects altered %s without changing the original response digest", async (field) => {
    const f = await failureFixture();
    let safeCode: unknown = f.safeCode;
    if (field === "retryable") f.call.retryable = true;
    if (field === "errorClass") f.call.errorClass = "transient";
    if (field === "dispatchState") f.call.dispatchState = "dispatched";
    if (field === "observedAt") f.call.finishedAt = new Date(f.call.finishedAt!.getTime() + 1);
    if (field === "safeCode") safeCode = "PROVIDER_OTHER";
    if (field === "missingSafeCode") safeCode = undefined;
    await expect(
      npRequireAgentRuntimeProviderFailureReceiptV1(f.call, safeCode),
    ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_EVIDENCE_INVALID" });
  });
});
