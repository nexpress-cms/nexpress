import { randomUUID } from "node:crypto";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import {
  createAgentRuntimeControlsV1,
  npWithAgentRuntimeControlTransactionV1,
} from "../../../packages/core/src/agent/runtime-controls.js";
import {
  npCreateDisabledAgentRuntimeSettingsV1,
  npCreateInheritedAgentBudgetV1,
  type NpAgentConfigurationDefinitionV1,
} from "../../../packages/core/src/agent-contract/runtime-contract.js";
import {
  npAgentBudgetDimensionKeysV1,
  type NpAgentBudgetV1,
} from "../../../packages/core/src/agent-contract/wire-contract.js";
import type { NpAgentRecipeRegistryCanonicalV1 } from "../../../packages/core/src/agent-contract/types.js";

export { siteId };
export const runtimeFingerprint = `cj1:sha256:${"A".repeat(43)}`;
export function runtimeBudget(overrides: Partial<NpAgentBudgetV1> = {}): NpAgentBudgetV1 {
  const budget = npCreateInheritedAgentBudgetV1();
  for (const key of npAgentBudgetDimensionKeysV1)
    budget[key] = key === "incidentAnalysisCooldownSeconds" ? 0 : 1_000;
  return { ...budget, ...overrides };
}
export function runtimeDefinition(): NpAgentConfigurationDefinitionV1 {
  return {
    schemaVersion: "np.agent-configuration-definition.v1",
    name: "Worker observer",
    template: "operator",
    modelConnectionId: null,
    model: null,
    scopes: ["site:read"],
    autonomy: "observe",
    capabilityModes: [{ capabilityId: "site.inspect", mode: "observe" }],
    policyMode: "site",
    budget: npCreateInheritedAgentBudgetV1(),
    settings: [
      {
        recipeId: "operator.worker-not-draining",
        recipeVersion: 1,
        staleAfterSeconds: 60,
        minimumPendingJobs: 1,
        checkIds: ["jobs.worker"],
      },
    ],
  };
}
export function runtimeRecipes(): NpAgentRecipeRegistryCanonicalV1 {
  return {
    schemaVersion: "np.agent-recipe-registry.v1",
    projection: "registry",
    recipes: [
      {
        id: "operator.worker-not-draining",
        version: 1,
        allowedTemplates: ["operator"],
        task: "interactive-capability",
        providerMode: "forbidden",
        triggerKinds: ["manual"],
        capabilityIds: ["site.inspect"],
        settingsSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties: {
            recipeId: { type: "string", const: "operator.worker-not-draining", maxLength: 128 },
            recipeVersion: { type: "integer", const: 1, minimum: 1, maximum: 1 },
            staleAfterSeconds: { type: "integer", minimum: 60, maximum: 86400 },
            minimumPendingJobs: { type: "integer", minimum: 1, maximum: 100000 },
            checkIds: {
              type: "array",
              minItems: 1,
              maxItems: 32,
              uniqueItems: true,
              items: { type: "string", maxLength: 128 },
            },
          },
          required: [
            "checkIds",
            "minimumPendingJobs",
            "recipeId",
            "recipeVersion",
            "staleAfterSeconds",
          ],
        },
        manualInputSchema: null,
        responseSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties: {},
          required: [],
        },
        instruction: null,
      },
    ],
  };
}
export async function runtimeFixture(budget = runtimeBudget(), activate = true) {
  const f = await fixture();
  let now = new Date();
  const state = { ready: true, fingerprint: runtimeFingerprint };
  const controls = createAgentRuntimeControlsV1({
    deploymentActorFingerprint: runtimeFingerprint,
    now: () => now,
    readiness: async () => ({
      checks: {
        doctor: "ready",
        policy: "ready",
        budget: "ready",
        vault: "not-required",
        integrityKey: "ready",
        worker: state.ready ? "ready" : "blocked",
      },
      fingerprint: state.fingerprint,
    }),
  });
  const settings = npCreateDisabledAgentRuntimeSettingsV1();
  settings.enabled = true;
  settings.defaultPolicyRules.capabilityModes = [{ capabilityId: "site.inspect", mode: "observe" }];
  await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision }) =>
    controls.updateInTransaction({
      db,
      siteId,
      expectedRevision: revision,
      actorFingerprint: runtimeFingerprint,
      settings,
    }),
  );
  const deploymentAuthority = {
    policyId: "runtime-test",
    fingerprint: runtimeFingerprint,
    scopes: ["site:read"] as const,
  };
  const options = {
    recipes: runtimeRecipes(),
    controls,
    deploymentAuthority: { ...deploymentAuthority, scopes: [...deploymentAuthority.scopes] },
    deploymentBudget: budget,
    frameworkPolicy: { version: 1, rules: structuredClone(settings.defaultPolicyRules) },
    now: () => now,
    reauthentication: { verify: () => true },
  };
  const service = createAgentRuntimeServiceV1(options);
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
  const definition = runtimeDefinition();
  const created = await service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.configurations.create",
    targetId: null,
    command: { idempotencyKey: randomUUID(), ...npBuildAgentRuntimeDefinitionInputV1(definition) },
  });
  let current = created;
  if (activate)
    current = await service.executeAdmin({
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
  const runInput = {
    siteId,
    agentId: created.resourceId,
    expectedVersionId: current.output.versionId as string,
    recipeId: "operator.worker-not-draining" as const,
    idempotencyKey: randomUUID(),
  };
  return {
    ...f,
    service,
    admission,
    controls,
    options,
    settings,
    created,
    current,
    definition,
    runInput,
    state,
    advance: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}
