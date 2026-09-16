import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { randomUUID } from "node:crypto";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import {
  runtimeFixture,
  runtimeDefinition,
  runtimeBudget,
  siteId,
} from "./agent-runtime-service-fixture.js";
export async function runtimeReadCapabilityFixture() {
  const f = await runtimeFixture(runtimeBudget(), false);
  const definition = runtimeDefinition();
  definition.scopes = ["content:read", "site:read"];
  definition.capabilityModes = [{ capabilityId: "content.query", mode: "observe" }];
  const recipes = structuredClone(f.options.recipes);
  recipes.recipes[0].capabilityIds = ["content.query"];
  const settings = structuredClone(f.settings);
  settings.defaultPolicyRules.capabilityModes = definition.capabilityModes;
  await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision }) =>
    f.controls.updateInTransaction({
      db,
      siteId,
      expectedRevision: revision,
      actorFingerprint: f.options.deploymentAuthority.fingerprint,
      settings,
    }),
  );
  const options = {
    ...f.options,
    recipes,
    deploymentAuthority: { ...f.options.deploymentAuthority, scopes: definition.scopes },
    frameworkPolicy: { version: 1, rules: settings.defaultPolicyRules },
  };
  const service = createAgentRuntimeServiceV1(options);
  const created = await service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.configurations.create",
    targetId: null,
    command: { idempotencyKey: randomUUID(), ...npBuildAgentRuntimeDefinitionInputV1(definition) },
  });
  const active = await service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.configurations.activate",
    targetId: created.resourceId,
    command: {
      expectedVersion: 1,
      configHash: created.output.configHash,
      idempotencyKey: randomUUID(),
    },
  });
  const admission = createAgentRuntimeAdmissionV1({
    ...options,
    runLimits: {
      schemaVersion: "np.agent-run-limits.v1",
      maxAttempts: 2,
      maxProviderCalls: 2,
      maxCapabilityCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxCostMicros: 100,
      maxWallClockSeconds: 120,
    },
  });
  const runInput = {
    ...f.runInput,
    agentId: created.resourceId,
    expectedVersionId: active.output.versionId as string,
  };
  const executors = createAgentCoreReadCapabilityExecutorsV1({
    cursorHmacKey: { id: "runtime-test", key: new Uint8Array(32).fill(7) },
    resolveUser: () => null,
    resolveBlockSchemas: () => [],
  });
  const readState = { fail: false };
  executors["content.query"] = async (input) => {
    if (readState.fail) throw new Error("private-runtime-read-failure");
    return {
      schemaVersion: "np.agent-content-query.v1",
      collection: input.collection,
      items: [],
      nextCursor: null,
    };
  };
  const registry = await createAgentReadCapabilityRegistryV1(executors);
  const capability = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: admission,
    resolveGatewaySettings: () => ({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "disabled",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    }),
    now: f.options.now,
  });
  const { runId } = await admission.admit(runInput);
  const store = createAgentRuntimeExecutionStoreV1({ admission, now: f.options.now });
  const acquired = await store.claim({ siteId, runId });
  if (!acquired.claim) throw new Error("Expected runtime claim");
  const input = {
    siteId,
    runId,
    claim: acquired.claim,
    sequence: 1,
    request: {
      schemaVersion: "np.agent-invocation-request.v1" as const,
      capabilityId: "content.query" as const,
      arguments: {
        input: {
          collection: "posts",
          filter: null,
          fields: [],
          audience: "public" as const,
          status: "published" as const,
          sort: [],
          limit: 10,
          cursor: null,
        },
        idempotencyKey: null,
      },
    },
  };
  return { ...f, admission, registry, capability, store, input, readState, runInput };
}
