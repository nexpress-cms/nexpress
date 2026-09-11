import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createSite } from "@nexpress/core";
import {
  npAgents,
  npAgentVersions,
  npAgentPrincipals,
  npAgentConnections,
  npAgentConnectionConfigVersions,
  npAgentConnectionSecretVersions,
  npAgentVaultOperations,
  npAgentRuns,
  npAgentUsageReservations,
  npAgentProviderCalls,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npCreateDisabledAgentRuntimeSettingsV1,
  npCreateInheritedAgentBudgetV1,
} from "../../../packages/core/src/agent-contract/runtime-contract.js";
import type { NpAgentRecipeRegistryCanonicalV1 } from "../../../packages/core/src/agent-contract/types.js";
import { getTestDb } from "./harness.js";

export const npRuntimePersistenceDigest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const npRuntimePersistencePricing = "pr1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const npRuntimePersistenceAt = new Date("2026-09-01T00:00:00.000Z");
export const npRuntimePersistenceLater = new Date("2026-09-01T00:01:00.000Z");
export const npRuntimePersistencePolicy =
  npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;

const registry: NpAgentRecipeRegistryCanonicalV1 = {
  schemaVersion: "np.agent-recipe-registry.v1",
  projection: "registry",
  recipes: [
    {
      id: "operator.worker-not-draining",
      version: 1,
      allowedTemplates: ["custom", "operator"],
      task: "interactive-capability",
      providerMode: "forbidden",
      triggerKinds: ["manual"],
      capabilityIds: ["site.inspect"],
      settingsSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
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

export async function npCreateRuntimePersistenceFixture(siteId = "runtime-a") {
  const db = await getTestDb();
  await createSite({ id: siteId, name: "Runtime persistence" });
  const principalId = randomUUID(),
    agentId = randomUUID(),
    versionId = randomUUID();
  await db.insert(npAgentPrincipals).values({
    id: principalId,
    siteId,
    kind: "runtime",
    name: "Runtime principal",
    status: "suspended",
    scopes: [],
    authorityKind: "deployment",
    authorityPolicyId: "runtime-fixture",
    authorityFingerprint: npRuntimePersistenceDigest,
  });
  await db.insert(npAgents).values({
    id: agentId,
    siteId,
    principalId,
    name: "Runtime",
    template: "operator",
    status: "draft",
    createdAt: npRuntimePersistenceAt,
    updatedAt: npRuntimePersistenceAt,
  });
  const version: typeof npAgentVersions.$inferInsert = {
    id: versionId,
    siteId,
    agentId,
    version: 1,
    status: "draft",
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
    recipeRegistryBody: registry,
    recipeRegistryFingerprint: npRuntimePersistenceDigest,
    configHash: npRuntimePersistenceDigest,
    createdAt: npRuntimePersistenceAt,
  };
  await db.insert(npAgentVersions).values(version);
  await db.update(npAgents).set({ draftVersionId: versionId }).where(eq(npAgents.id, agentId));
  return { db, siteId, principalId, agentId, versionId, version };
}

export function npRuntimePersistenceRun(
  fixture: Awaited<ReturnType<typeof npCreateRuntimePersistenceFixture>>,
  overrides: Partial<typeof npAgentRuns.$inferInsert> = {},
): typeof npAgentRuns.$inferInsert {
  const id = randomUUID();
  return {
    id,
    siteId: fixture.siteId,
    origin: "runtime",
    agentId: fixture.agentId,
    agentVersionId: fixture.versionId,
    agentConfigHash: npRuntimePersistenceDigest,
    principalId: fixture.principalId,
    admissionFingerprint: `cj1:sha256:${id.replaceAll("-", "").padEnd(43, "A")}`,
    rootRunId: id,
    causalDepth: 0,
    recipeId: "operator.worker-not-draining",
    recipeVersion: 1,
    recipeFingerprint: npRuntimePersistenceDigest,
    responseSchemaDigest: npRuntimePersistenceDigest,
    state: "queued",
    goal: "Observe worker posture",
    policyRefs: [],
    runtimeAdmissionSources: {
      schemaVersion: "np.agent-runtime-admission-sources.v1",
      frameworkPolicy: {
        schemaVersion: "np.agent-policy.v1",
        instructions: "",
        rules: npRuntimePersistencePolicy,
      },
      frameworkPolicyVersion: 1,
      sitePolicy: {
        schemaVersion: "np.agent-policy.v1",
        instructions: "",
        rules: npRuntimePersistencePolicy,
      },
      deploymentBudget: npCreateInheritedAgentBudgetV1(),
      siteBudget: npCreateInheritedAgentBudgetV1(),
    },
    runLimits: {
      schemaVersion: "np.agent-run-limits.v1",
      maxAttempts: 1,
      maxProviderCalls: 1,
      maxCapabilityCalls: 1,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxCostMicros: 100,
      maxWallClockSeconds: 60,
    },
    runLimitsHash: npRuntimePersistenceDigest,
    budgetSnapshot: {},
    budgetSnapshotHash: npRuntimePersistenceDigest,
    idempotencyKey: id,
    attempt: 1,
    usage: {
      providerCalls: 0,
      capabilityCalls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    },
    queuedAt: npRuntimePersistenceAt,
    deadlineAt: npRuntimePersistenceLater,
    ...overrides,
  };
}

export async function npRuntimePersistenceConnection(
  fixture: Awaited<ReturnType<typeof npCreateRuntimePersistenceFixture>>,
) {
  const { db, siteId } = fixture;
  const connectionId = randomUUID(),
    configId = randomUUID(),
    secretId = randomUUID(),
    sealId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(npAgentConnections).values({
      id: connectionId,
      siteId,
      kind: "model",
      provider: "runtime-fixture",
      adapterContractVersion: 1,
      name: "Unconfigured model",
      authKind: "api_key",
      activeConfigSnapshotId: configId,
      config: {},
      configVersion: 1,
      configHash: npRuntimePersistenceDigest,
      pricingCatalogFingerprint: npRuntimePersistenceDigest,
      dataProcessingCeiling: "public-only",
      status: "pending",
    });
    await tx.insert(npAgentConnectionConfigVersions).values({
      id: configId,
      siteId,
      connectionId,
      version: 1,
      adapterId: "runtime-fixture",
      adapterContractVersion: 1,
      adapterFingerprint: npRuntimePersistenceDigest,
      config: {},
      configHash: npRuntimePersistenceDigest,
      pricingCatalog: [],
      pricingCatalogFingerprint: npRuntimePersistenceDigest,
      dataProcessingCeiling: "public-only",
      state: "active",
      activatedAt: npRuntimePersistenceAt,
    });
    await tx.insert(npAgentConnectionSecretVersions).values({
      id: secretId,
      siteId,
      connectionId,
      version: 1,
      status: "pending",
      purpose: "connection-credential",
      vaultAdapter: "runtime-fixture",
      vaultAdapterContractVersion: 1,
      vaultAdapterFingerprint: npRuntimePersistenceDigest,
      sealOperationId: sealId,
      materialKind: "api_key",
      credentialEnvelopeVersion: 1,
      vaultAlgorithm: "AES-256-GCM",
      aadBody: {
        schemaVersion: "np.agent-vault-aad.v1",
        siteId,
        connectionId,
        connectionKind: "model",
        purpose: "connection-credential",
        secretVersionId: secretId,
        secretVersion: 1,
        vaultAdapterId: "runtime-fixture",
        vaultAdapterContractVersion: 1,
        vaultAdapterFingerprint: npRuntimePersistenceDigest,
        credentialEnvelopeVersion: 1,
        algorithm: "AES-256-GCM",
      },
      aadDigest: npRuntimePersistenceDigest,
    });
    await tx.insert(npAgentVaultOperations).values({
      id: sealId,
      siteId,
      connectionId,
      secretVersionId: secretId,
      kind: "seal",
      state: "queued",
      vaultAdapter: "runtime-fixture",
      vaultAdapterContractVersion: 1,
      vaultAdapterFingerprint: npRuntimePersistenceDigest,
      idempotencyKey: sealId,
      requestDigestKeyId: "fixture",
      requestDigest: npRuntimePersistenceDigest,
    });
  });
  return { connectionId, configId, secretId };
}

export async function npRuntimePersistenceProviderFixture() {
  const fixture = await npCreateRuntimePersistenceFixture();
  const connection = await npRuntimePersistenceConnection(fixture);
  const run = npRuntimePersistenceRun(fixture, {
    connectionId: connection.connectionId,
    connectionConfigSnapshotId: connection.configId,
    connectionConfigVersion: 1,
    connectionConfigHash: npRuntimePersistenceDigest,
    providerDataClassCeiling: "public-only",
    instructionTemplateId: "operator.worker-not-draining",
    instructionTemplateVersion: 1,
    instructionDigest: npRuntimePersistenceDigest,
    pricingId: "fixture",
    pricingVersion: 1,
    pricingFingerprint: npRuntimePersistencePricing,
    pricingEffectiveAt: npRuntimePersistenceAt,
  });
  await fixture.db.insert(npAgentRuns).values(run);
  if (!run.id) throw new Error("Fixture run identity missing");
  const reservation: typeof npAgentUsageReservations.$inferInsert = {
    id: randomUUID(),
    siteId: fixture.siteId,
    agentId: fixture.agentId,
    runId: run.id,
    connectionId: connection.connectionId,
    connectionConfigSnapshotId: connection.configId,
    model: "fixture-model",
    pricingId: "fixture",
    pricingVersion: 1,
    pricingFingerprint: npRuntimePersistencePricing,
    pricingEffectiveAt: npRuntimePersistenceAt,
    idempotencyKey: randomUUID(),
    state: "reserved",
    reservedCalls: 1,
    reservedInputTokens: 100,
    reservedOutputTokens: 100,
    reservedCostMicros: 100,
    reservedAt: npRuntimePersistenceAt,
    expiresAt: npRuntimePersistenceLater,
  };
  await fixture.db.insert(npAgentUsageReservations).values(reservation);
  if (!reservation.id) throw new Error("Fixture reservation identity missing");
  const call: typeof npAgentProviderCalls.$inferInsert = {
    id: randomUUID(),
    siteId: fixture.siteId,
    runId: run.id,
    sequence: 1,
    connectionId: connection.connectionId,
    connectionConfigSnapshotId: connection.configId,
    secretVersionId: connection.secretId,
    credentialVersion: 1,
    connectionConfigVersion: 1,
    connectionConfigHash: npRuntimePersistenceDigest,
    providerDataClassCeiling: "public-only",
    requestDataClass: "public-only",
    classificationManifest: {},
    classificationManifestDigest: npRuntimePersistenceDigest,
    recipeId: "operator.worker-not-draining",
    recipeVersion: 1,
    recipeFingerprint: npRuntimePersistenceDigest,
    instructionTemplateId: "operator.worker-not-draining",
    instructionTemplateVersion: 1,
    instructionDigest: npRuntimePersistenceDigest,
    responseSchemaDigest: npRuntimePersistenceDigest,
    provider: "runtime-fixture",
    model: "fixture-model",
    pricingId: "fixture",
    pricingVersion: 1,
    pricingFingerprint: npRuntimePersistencePricing,
    pricingEffectiveAt: npRuntimePersistenceAt,
    state: "reserved",
    dispatchState: "not-dispatched",
    usageReservationId: reservation.id,
    requestDigest: npRuntimePersistenceDigest,
    idempotencyKey: randomUUID(),
    createdAt: npRuntimePersistenceAt,
  };
  return { ...fixture, ...connection, run, reservation, call };
}
