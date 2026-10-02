import { npCreateAgentOperatorAppHostV1 } from "../../../packages/app/src/lib/agents/operator-host";
import { setJobsPauseState } from "../../../packages/core/src/jobs/pause-state.js";
import type { NpAgentProviderInferenceFacetV1 } from "../../../packages/core/src/agent/provider-auth-contract.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npCreateAgentOperatorRecipeDefinitionV1,
  npAgentOperatorRecipeSetupV1,
} from "../../../packages/core/src/agent-contract/operator-recipe-contract.js";
import type {
  NpAgentProviderInvokeOutcomeV1,
  NpAgentJsonObject,
} from "../../../packages/core/src/agent-contract/types.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { createAgentOperatorServiceV1 } from "../../../packages/core/src/agent/operator-service.js";
import {
  createAgentOperatorCapabilityFacadeV1,
  type NpAgentOperatorCapabilityFacadeV1,
} from "../../../packages/core/src/agent/operator-capability.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { NpAgentGatewayError } from "../../../packages/core/src/agent/admin-admission.js";
import {
  npAgentActions,
  npAgentOperatorExecutions,
} from "../../../packages/core/src/db/schema/agent.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { runtimeDefinition, siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

function outcome(decision: NpAgentJsonObject): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "succeeded",
    provider: "fake-provider",
    model: "fake-model",
    providerRequestId: null,
    output: { task: "interactive-capability", decision },
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

describe.skipIf(skipIfNoTestDb())("Shipped Operator recipe Runtime", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it.each([false, true])(
    "retains diagnostic facts, plans without execution, and fences authority loss=%s",
    async (revoke) => {
      const recipe = await npCreateAgentOperatorRecipeDefinitionV1();
      const definition = runtimeDefinition();
      definition.settings = [structuredClone(npAgentOperatorRecipeSetupV1.settings)];
      definition.autonomy = "advise";
      definition.scopes = ["audit:run", "ops:plan", "ops:read", "site:read"];
      definition.capabilityModes = [
        { capabilityId: "audit.run", mode: "advise" },
        { capabilityId: "ops.plan", mode: "advise" },
        { capabilityId: "ops.status", mode: "observe" },
      ];
      let allowed = true;
      const invoke = vi
        .fn<NpAgentProviderInferenceFacetV1["invoke"]>()
        .mockResolvedValueOnce(
          outcome({
            kind: "propose-capability",
            capabilityId: "ops.status",
            rationale: "Inspect current deployment worker facts.",
            arguments: { families: ["jobs"] },
          }),
        )
        .mockImplementationOnce(async (request) => {
          expect(request.trustedContext.some((entry) => entry.id === "recipe-settings")).toBe(true);
          expect(
            request.trustedContext.some(
              (entry) =>
                entry.text.includes("operator.worker") &&
                entry.text.includes("Deployment snapshot: paused"),
            ),
          ).toBe(true);
          if (revoke) allowed = false;
          return outcome({
            kind: "propose-capability",
            capabilityId: "ops.plan",
            rationale: "Request an owner-reviewed local plan.",
            arguments: {
              action: "queue.global.plan",
              target: { kind: "queue", operation: "drain", jobName: null },
            },
          });
        })
        .mockResolvedValue(
          outcome({
            kind: "complete",
            summary: "Diagnostic evidence retained; plan requires local review.",
          }),
        );
      const runtime = await runtimeUsageFixture({
        delegated: true,
        definition,
        recipe,
        responseSchema: recipe.responseSchema,
        dataClassCeiling: "internal-redacted",
        providerInference: { invoke },
        limits: { maxProviderCalls: 4, maxCapabilityCalls: 3 },
      });
      const plan = vi.fn(async () => ({
        artifact: { schemaVersion: "fixture.operator-review.v1", check: "bounded-owner-plan" },
        contractId: "fixture.queue.review.v1",
        projectCommand: "Review deployment queue runbook with the host operator",
        checks: [{ id: "owner", status: "pass" as const }],
      }));
      const host = npCreateAgentOperatorAppHostV1({
        authorize: async () => {
          if (!allowed) throw new NpAgentGatewayError("FORBIDDEN", 403, "Unavailable.");
        },
        authorizeDeployment: async () => allowed,
        workerDiagnostics: "pg-boss",
        planOwners: { "queue.global.plan": plan },
      });
      const registry = await createAgentReadCapabilityRegistryV1(
        createAgentCoreReadCapabilityExecutorsV1({
          cursorHmacKey: { id: "operator-recipe", key: new Uint8Array(32).fill(73) },
          resolveBlockSchemas: () => [],
          resolveUser: () => runtime.actor.actor.user,
          opsStatus: host.status,
        }),
      );
      let facade: NpAgentOperatorCapabilityFacadeV1 | null = null;
      const capabilities = createAgentCapabilityAdmissionServiceV1({
        registry,
        runtimeAdmission: runtime.admission,
        resolveOperatorCapabilities: () => facade,
        resolveGatewaySettings: () => ({
          schemaVersion: "np.agent-gateway-settings.v1",
          stdio: "disabled",
          mcpHttp: "disabled",
          agentHttp: "disabled",
        }),
        now: runtime.options.now,
      });
      const service = createAgentOperatorServiceV1({
        admission: capabilities,
        runtimeAdmission: runtime.admission,
        resolveTransportAudience: async () => "https://unused.example",
        host,
        now: runtime.options.now,
      });
      facade = createAgentOperatorCapabilityFacadeV1(service);
      const store = createAgentRuntimeExecutionStoreV1({
        admission: runtime.admission,
        now: runtime.options.now,
        approval: capabilities,
      });
      const context = createAgentRuntimeContextV1({
        admission: runtime.admission,
        capabilities: {
          list: capabilities.sourceEntries,
          actionOutcomes: capabilities.runtimeActionOutcomes,
        },
      });
      const usage = createAgentRuntimeUsageV1({
        admission: runtime.admission,
        ambiguityWindowSeconds: 300,
        verifyRequest: context.verifyRequest,
        now: runtime.options.now,
      });
      const provider = createAgentProviderInferenceRuntimeV1({
        registry: runtime.providerRegistry,
        now: runtime.options.now,
      });
      const breakers = createAgentRuntimeBreakersV1({
        failureThreshold: 3,
        windowSeconds: 60,
        cooldownSeconds: 30,
        now: runtime.options.now,
      });
      const executor = createAgentRuntimeExecutorV1({
        store,
        context,
        usage,
        provider,
        providerRegistry: runtime.providerRegistry,
        vault: runtime.vault,
        capabilities,
        breakers,
        now: runtime.options.now,
      });
      await setJobsPauseState({ paused: true });
      try {
        const input = { siteId, runId: runtime.runId };
        const result = await executor.process(input);
        expect(plan).toHaveBeenCalledTimes(revoke ? 0 : 1);
        expect(result.state).toBe(revoke ? "failed" : "succeeded");
        expect(await runtime.db.select().from(npAgentOperatorExecutions)).toEqual([]);
        const actions = await runtime.db
          .select()
          .from(npAgentActions)
          .where(eq(npAgentActions.runId, runtime.runId));
        expect(
          actions.some(
            (action) => action.capabilityId === "ops.status" && action.state === "succeeded",
          ),
        ).toBe(true);
        const calls = invoke.mock.calls.length;
        expect(await executor.process(input)).toEqual(result);
        expect(invoke).toHaveBeenCalledTimes(calls);
      } finally {
        executor.shutdown();
        context.dispose();
        await provider.shutdown();
        await runtime.dispose();
      }
    },
  );
});
