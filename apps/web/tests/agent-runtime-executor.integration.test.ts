import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { npAgentDisabledGatewaySettingsV1 } from "../../../packages/core/src/agent-contract/types.js";
import type { NpAgentProviderInvokeOutcomeV1 } from "../../../packages/core/src/agent-contract/types.js";
import {
  npAgentProviderCalls,
  npAgentUsageReservations,
} from "../../../packages/core/src/db/schema/agent.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const cleanups: Array<() => Promise<void>> = [];
function success(): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "succeeded",
    provider: "fake-provider",
    model: "fake-model",
    providerRequestId: null,
    output: { task: "interactive-capability", decision: { kind: "complete", summary: "Done" } },
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      tokenSource: "provider",
      costMicros: 3,
      costSource: "adapter-estimate",
    },
    finishReason: "stop",
    latencyMs: 0,
  };
}
async function fixture(invoke = vi.fn().mockResolvedValue(success())) {
  const f = await runtimeUsageFixture({
    dataClassCeiling: "internal-redacted",
    providerInference: { invoke },
  });
  const store = createAgentRuntimeExecutionStoreV1({ admission: f.admission, now: f.options.now });
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "runtime-executor", key: new Uint8Array(32).fill(7) },
      resolveUser: () => null,
      resolveBlockSchemas: () => [],
    }),
  );
  const capabilities = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: f.admission,
    resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
    now: f.options.now,
  });
  const context = createAgentRuntimeContextV1({
    admission: f.admission,
    capabilities: {
      list: capabilities.sourceEntries,
      actionOutcomes: capabilities.runtimeActionOutcomes,
    },
  });
  const usage = createAgentRuntimeUsageV1({
    admission: f.admission,
    ambiguityWindowSeconds: 300,
    verifyRequest: context.verifyRequest,
    now: f.options.now,
  });
  const provider = createAgentProviderInferenceRuntimeV1({
    registry: f.providerRegistry,
    now: f.options.now,
  });
  const breakers = createAgentRuntimeBreakersV1({
    failureThreshold: 3,
    windowSeconds: 60,
    cooldownSeconds: 30,
    now: f.options.now,
  });
  const executor = createAgentRuntimeExecutorV1({
    store,
    context,
    usage,
    provider,
    providerRegistry: f.providerRegistry,
    vault: f.vault,
    capabilities,
    breakers,
    now: f.options.now,
  });
  cleanups.push(async () => {
    executor.shutdown();
    context.dispose();
    await provider.shutdown();
    await f.dispose();
  });
  return { ...f, executor, invoke, input: { siteId, runId: f.runId } };
}
describe.skipIf(skipIfNoTestDb())("explicit Runtime executor", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });
  afterAll(closeTestDb);
  it("completes one explicit provider turn and never repeats a terminal run", async () => {
    const f = await fixture();
    expect(await f.executor.process(f.input)).toEqual({ state: "succeeded" });
    expect(await f.executor.process(f.input)).toEqual({ state: "succeeded" });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    const reservations = await f.db.select().from(npAgentUsageReservations);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ state: "reconciled", budgetChargeCostMicros: 3 });
  });
  it("contains an ambiguous provider failure without replaying or releasing unknown cost", async () => {
    const f = await fixture(vi.fn().mockRejectedValue(new Error("private provider failure")));
    expect(await f.executor.process(f.input)).toEqual({ state: "failed" });
    expect(await f.executor.process(f.input)).toEqual({ state: "failed" });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect((await f.db.select().from(npAgentProviderCalls))[0]).toMatchObject({
      state: "ambiguous",
      dispatchState: "unknown",
      retryable: false,
    });
    expect((await f.db.select().from(npAgentUsageReservations))[0]?.state).toBe("reserved");
  });
  it("allows only one concurrent processor to spend", async () => {
    const f = await fixture();
    await Promise.all([f.executor.process(f.input), f.executor.process(f.input)]);
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(1);
  });
  it("does not spend after cancellation or shutdown", async () => {
    const f = await fixture();
    expect(await f.executor.cancel(f.input)).toEqual({ state: "cancelled" });
    expect(await f.executor.process(f.input)).toEqual({ state: "cancelled" });
    f.executor.shutdown();
    await expect(f.executor.process(f.input)).rejects.toMatchObject({
      code: "RUNTIME_EXECUTOR_CLOSED",
    });
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("releases an unsent reservation after a Vault failure", async () => {
    const f = await fixture();
    vi.spyOn(f.vault, "leaseProviderCredential").mockRejectedValue(
      new Error("private Vault failure"),
    );
    expect(await f.executor.process(f.input)).toEqual({ state: "failed" });
    expect(f.invoke).not.toHaveBeenCalled();
    expect((await f.db.select().from(npAgentProviderCalls))[0]).toMatchObject({
      state: "cancelled",
      dispatchState: "not-dispatched",
    });
    expect((await f.db.select().from(npAgentUsageReservations))[0]).toMatchObject({
      state: "released",
      budgetChargeCostMicros: 0,
    });
  });
  it("never treats a cancelled provider result as a new unlinked turn", async () => {
    const outcome: NpAgentProviderInvokeOutcomeV1 = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "failed",
      provider: "fake-provider",
      model: "fake-model",
      providerRequestId: null,
      output: null,
      errorClass: "cancelled",
      safeCode: "PROVIDER_CANCELLED",
      retryable: false,
      dispatchState: "not-dispatched",
      usage: null,
      finishReason: null,
      latencyMs: 0,
    };
    const f = await fixture(vi.fn().mockResolvedValue(outcome));
    expect(await f.executor.process(f.input)).toEqual({ state: "failed" });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(await f.executor.process(f.input)).toEqual({ state: "failed" });
    expect(f.invoke).toHaveBeenCalledTimes(1);
  });
});
