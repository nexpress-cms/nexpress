import { eq } from "drizzle-orm";
import { createAgentOperatorServiceV1 } from "../../../packages/core/src/agent/operator-service.js";
import {
  createAgentOperatorCapabilityFacadeV1,
  type NpAgentOperatorCapabilityFacadeV1,
} from "../../../packages/core/src/agent/operator-capability.js";
import { runtimeDefinition } from "./agent-runtime-service-fixture.js";
import type { NpAgentJsonSchema } from "../../../packages/core/src/agent-contract/types.js";
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
  npAgentActions,
  npAgentInvocations,
  npAgentOperatorPlans,
  npAgentRuns,
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
async function fixture(
  invoke = vi.fn().mockResolvedValue(success()),
  operator?: { responseSchema: NpAgentJsonSchema },
) {
  const definition = runtimeDefinition();
  if (operator) {
    definition.scopes = ["ops:plan", "site:read"];
    definition.autonomy = "advise";
    definition.capabilityModes = [{ capabilityId: "ops.plan", mode: "advise" }];
  }
  const f = await runtimeUsageFixture({
    dataClassCeiling: "internal-redacted",
    providerInference: { invoke },
    ...(operator ? { definition, delegated: true, responseSchema: operator.responseSchema } : {}),
  });
  const store = createAgentRuntimeExecutionStoreV1({
    admission: f.admission,
    now: f.options.now,
    ...(operator ? { leaseSeconds: 5 } : {}),
  });
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "runtime-executor", key: new Uint8Array(32).fill(7) },
      resolveUser: () => null,
      resolveBlockSchemas: () => [],
    }),
  );
  let operatorFacade: NpAgentOperatorCapabilityFacadeV1 | null = null;
  const capabilities = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: f.admission,
    resolveOperatorCapabilities: () => operatorFacade,
    resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
    now: f.options.now,
  });
  const planOwner = vi.fn(() =>
    Promise.resolve({
      artifact: { schemaVersion: "fixture.migration-plan.v1", pending: 0 },
      contractId: "ops.migrate",
      projectCommand: "pnpm --silent run ops:migrate -- plan --json",
      checks: [{ id: "migration.status", status: "pass" as const }],
    }),
  );
  if (operator) {
    operatorFacade = createAgentOperatorCapabilityFacadeV1(
      createAgentOperatorServiceV1({
        admission: capabilities,
        runtimeAdmission: f.admission,
        host: { assertAccess: () => Promise.resolve(), plan: planOwner },
        resolveTransportAudience: () => "https://example.test",
        now: f.options.now,
      }),
    );
  }
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
  return { ...f, executor, invoke, capabilities, planOwner, input: { siteId, runId: f.runId } };
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
  it("resumes after an Operator plan commit without creating a second action or artifact", async () => {
    const responseSchema: NpAgentJsonSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", const: "interactive-capability", maxLength: 64 },
        decision: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", const: "complete", maxLength: 64 },
                summary: { type: "string", maxLength: 128 },
              },
              required: ["kind", "summary"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", const: "propose-capability", maxLength: 64 },
                capabilityId: { type: "string", const: "ops.plan", maxLength: 128 },
                rationale: { type: "string", maxLength: 128 },
                arguments: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    action: { type: "string", const: "migration.plan", maxLength: 128 },
                    target: {
                      type: "object",
                      additionalProperties: false,
                      properties: { kind: { type: "string", const: "site", maxLength: 128 } },
                      required: ["kind"],
                    },
                  },
                  required: ["action", "target"],
                },
              },
              required: ["arguments", "capabilityId", "kind", "rationale"],
            },
          ],
        },
      },
      required: ["decision", "task"],
    };
    const proposal: NpAgentProviderInvokeOutcomeV1 = {
      ...success(),
      output: {
        task: "interactive-capability",
        decision: {
          kind: "propose-capability",
          capabilityId: "ops.plan",
          rationale: "Inspect the pending migration plan.",
          arguments: { action: "migration.plan", target: { kind: "site" } },
        },
      },
    };
    const f = await fixture(vi.fn().mockResolvedValueOnce(proposal).mockResolvedValue(success()), {
      responseSchema,
    });
    const original = f.capabilities.invokeRuntime.bind(f.capabilities);
    vi.spyOn(f.capabilities, "invokeRuntime").mockImplementationOnce(async (input) => {
      await original(input);
      // Simulate a process loss after its independent capability transaction committed.
      // The expired lease prevents the old executor from recording a terminal run state.
      f.advance(6);
      throw new Error("Simulated interruption after Operator commit");
    });
    await expect(f.executor.process(f.input)).rejects.toMatchObject({
      code: "RUNTIME_EXECUTION_FAILED",
    });
    const firstActions = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.runId, f.runId));
    expect(firstActions).toHaveLength(1);
    expect(firstActions[0]).toMatchObject({ state: "succeeded", capabilityId: "ops.plan" });
    const firstPlans = await f.db.select().from(npAgentOperatorPlans);
    expect(firstPlans).toHaveLength(1);
    const [firstInvocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, firstPlans[0].invocationId));
    expect(firstInvocation.idempotencyKey).toMatch(/^runtime:action:[a-f0-9]{64}$/);
    expect(await f.executor.process(f.input)).toEqual({ state: "succeeded" });
    expect(
      await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.runId)),
    ).toEqual(firstActions);
    expect(await f.db.select().from(npAgentOperatorPlans)).toEqual(firstPlans);
    expect(f.planOwner).toHaveBeenCalledTimes(1);
    expect(f.invoke).toHaveBeenCalledTimes(2);
    expect(f.invoke).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        limits: expect.objectContaining({ maxInputTokens: 100, maxOutputTokens: 100 }),
      }),
      expect.anything(),
    );
    expect(f.invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        limits: expect.objectContaining({ maxInputTokens: 99, maxOutputTokens: 99 }),
      }),
      expect.anything(),
    );
    const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId));
    expect(run).toMatchObject({ state: "succeeded", attempt: 2 });
  });
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
