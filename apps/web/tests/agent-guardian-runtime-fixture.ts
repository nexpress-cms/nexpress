import { createAgentOperatorServiceV1 } from "../../../packages/core/src/agent/operator-service.js";
import {
  createAgentOperatorCapabilityFacadeV1,
  type NpAgentOperatorCapabilityFacadeV1,
} from "../../../packages/core/src/agent/operator-capability.js";
import { runtimeDefinition } from "./agent-runtime-service-fixture.js";
import type {
  NpAgentJsonSchema,
  NpAgentJsonObject,
} from "../../../packages/core/src/agent-contract/types.js";
import { vi } from "vitest";
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
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";

function success(): Extract<NpAgentProviderInvokeOutcomeV1, { status: "succeeded" }> {
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
async function executorFixture(
  invoke = vi.fn().mockResolvedValue(success()),
  operator?: { responseSchema: NpAgentJsonSchema; denyDraft?: boolean },
  breakerFailureThreshold = 3,
) {
  const definition = runtimeDefinition();
  if (operator) {
    definition.scopes = operator.denyDraft
      ? ["content:read", "site:read"]
      : ["ops:plan", "site:read"];
    definition.autonomy = operator.denyDraft ? "observe" : "advise";
    definition.capabilityModes = operator.denyDraft
      ? [{ capabilityId: "content.query", mode: "observe" }]
      : [{ capabilityId: "ops.plan", mode: "advise" }];
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
        resolveTransportAudience: () => Promise.resolve("https://example.test"),
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
    failureThreshold: breakerFailureThreshold,
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
  const dispose = async () => {
    executor.shutdown();
    context.dispose();
    await provider.shutdown();
    await f.dispose();
  };
  return {
    ...f,
    executor,
    invoke,
    capabilities,
    planOwner,
    dispose,
    input: { siteId, runId: f.runId },
  };
}

/** Local fake-provider fixture. It executes the actual Runtime/provider ledger and capability owners. */
export async function guardianRuntimeExecutorFixture(
  mode: "repeat" | "denied",
  options: { breakerFailureThreshold?: number } = {},
) {
  const capabilityId = mode === "repeat" ? "ops.plan" : "content.query";
  const argumentsValue: NpAgentJsonObject =
    mode === "repeat"
      ? { action: "migration.plan", target: { kind: "site" } }
      : {
          collection: "posts",
          filter: null,
          fields: [],
          audience: "private",
          status: "draft",
          sort: [],
          limit: 10,
          cursor: null,
        };
  const argumentsSchema: NpAgentJsonObject =
    mode === "repeat"
      ? {
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
        }
      : {
          type: "object",
          additionalProperties: false,
          properties: {
            collection: { type: "string", const: "posts", maxLength: 128 },
            filter: { type: "null" },
            fields: { type: "array", maxItems: 0, items: { type: "string", maxLength: 128 } },
            audience: { type: "string", const: "private", maxLength: 7 },
            status: { type: "string", const: "draft", maxLength: 9 },
            sort: {
              type: "array",
              maxItems: 0,
              items: { type: "object", additionalProperties: false, properties: {}, required: [] },
            },
            limit: { type: "integer", const: 10, minimum: 1, maximum: 100 },
            cursor: { type: "null" },
          },
          required: [
            "collection",
            "filter",
            "fields",
            "audience",
            "status",
            "sort",
            "limit",
            "cursor",
          ],
        };
  const responseSchema: NpAgentJsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      task: { type: "string", const: "interactive-capability", maxLength: 64 },
      decision: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "propose-capability", maxLength: 64 },
          capabilityId: { type: "string", const: capabilityId, maxLength: 128 },
          rationale: { type: "string", maxLength: 128 },
          arguments: argumentsSchema,
        },
        required: ["arguments", "capabilityId", "kind", "rationale"],
      },
    },
    required: ["task", "decision"],
  };
  const proposal: NpAgentProviderInvokeOutcomeV1 = {
    ...success(),
    output: {
      task: "interactive-capability",
      decision: {
        kind: "propose-capability",
        capabilityId,
        rationale: "Controlled local fixture proposal",
        arguments: argumentsValue,
      },
    },
  };
  return executorFixture(
    vi.fn().mockResolvedValue(proposal),
    { responseSchema, denyDraft: mode === "denied" },
    options.breakerFailureThreshold,
  );
}
