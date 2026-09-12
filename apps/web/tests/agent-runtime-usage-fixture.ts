import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  runtimeFixture,
  runtimeRecipes,
  runtimeDefinition,
  runtimeBudget,
  runtimeFingerprint,
  siteId,
} from "./agent-runtime-service-fixture.js";
import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import {
  NpAgentConnectionAuthAdapterRegistryV1,
  NpAgentVaultAdapterRegistryV1,
  createAgentConnectionServiceV1,
  createAgentConnectionAdminServiceV1,
  createAgentFakeProviderAdapterV1,
  createAgentVaultServiceV1,
  createLocalEnvelopeVaultAdapterV1,
  type NpAgentConnectionAuthAdapterV1,
} from "../../../packages/core/src/agent/index.js";
import {
  npDigestAgentStudioConnectionDefinitionV1,
  npSerializeAgentStudioConnectionDefinitionV1,
} from "../../../packages/core/src/agent-contract/studio-contract.js";
import { npDigestAgentProviderRequestCanonical } from "../../../packages/core/src/agent-contract/canonical-provider.js";
import type { NpAgentBudgetV1 } from "../../../packages/core/src/agent-contract/wire-contract.js";
import type {
  NpAgentJsonSchema,
  NpAgentProviderRequestCanonicalV1,
  NpAgentProviderResponseCanonicalV1,
  NpAgentProviderDataClass,
  NpAgentCapabilityModeV1,
  NpAgentScope,
  NpAgentRunLimitsV1,
} from "../../../packages/core/src/agent-contract/types.js";
import {
  npAgentConnectionOperations,
  npAgentProviderCalls,
} from "../../../packages/core/src/db/schema/agent.js";

export const usageInstruction = "Return a bounded observation using the supplied public facts.";
const instructionDigest = `cj1:sha256:${createHash("sha256").update(usageInstruction).digest("base64url")}`;
export const usageResponseSchema: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    task: { type: "string", const: "interactive-capability", maxLength: 64 },
    decision: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", const: "complete", maxLength: 64 },
        summary: { type: "string", maxLength: 128 },
      },
      required: ["kind", "summary"],
    },
  },
  required: ["decision", "task"],
};
const classification = (sourceDigest: string) => ({
  sourceDigest,
  dataClass: "public-only" as const,
  classifierId: "fixture.public",
  classifierVersion: 1,
});

export async function runtimeUsageFixture(
  options: {
    budget?: NpAgentBudgetV1;
    agentBudget?: NpAgentBudgetV1;
    limits?: Partial<NpAgentRunLimitsV1>;
    verifier?: "present" | "absent" | "reject" | "throw";
    dataClassCeiling?: NpAgentProviderDataClass;
    documentCollection?: string;
    providerInference?: NpAgentConnectionAuthAdapterV1["inference"];
  } = {},
) {
  const f = await runtimeFixture(options.budget ?? runtimeBudget());
  const scopes: NpAgentScope[] = options.documentCollection
    ? ["content:read", "schema:read", "site:read"]
    : ["site:read"];
  const modes: NpAgentCapabilityModeV1[] = options.documentCollection
    ? [
        { capabilityId: "content.query", mode: "observe" },
        { capabilityId: "schema.get", mode: "observe" },
        { capabilityId: "site.inspect", mode: "observe" },
      ]
    : [{ capabilityId: "site.inspect", mode: "observe" }];
  const vaultRegistry = new NpAgentVaultAdapterRegistryV1();
  vaultRegistry.register(
    createLocalEnvelopeVaultAdapterV1({
      environment: "development",
      explicitlyEnabled: true,
      activeKey: { id: "runtime-usage-fixture", version: "v1", key: new Uint8Array(32).fill(31) },
      resolveDb: () => f.db,
    }),
    { active: true },
  );
  const vault = createAgentVaultServiceV1({
    registry: vaultRegistry,
    requestDigestKeyring: {
      active: { id: "runtime-usage-request", key: new Uint8Array(32).fill(37) },
    },
    resolveDb: () => f.db,
  });
  const provider: NpAgentConnectionAuthAdapterV1 = {
    ...createAgentFakeProviderAdapterV1(),
    ...(options.providerInference ? { inference: options.providerInference } : {}),
  };
  const providerRegistry = new NpAgentConnectionAuthAdapterRegistryV1().register(provider);
  const connections = createAgentConnectionServiceV1({
    providerRegistry,
    vault,
    projectionKeyring: {
      accountSubject: {
        owner: "connection-account-subject",
        id: "usage-account",
        bytes: new Uint8Array(32).fill(41),
      },
      destination: {
        owner: "connection-destination",
        id: "usage-destination",
        bytes: new Uint8Array(32).fill(43),
      },
    },
    stateHashKeyring: { active: { id: "usage-state", key: new Uint8Array(32).fill(47) } },
    resolveOAuthClientConfigDigest: () => runtimeFingerprint,
    resolveDb: () => f.db,
  });
  const admin = createAgentConnectionAdminServiceV1({
    connections,
    reauthentication: { verify: () => true },
    secretRequestDigestKey: { id: "usage-admin", key: new Uint8Array(32).fill(53) },
  });
  const definition = {
    schemaVersion: "np.agent-studio-connection-definition.v1" as const,
    name: "Runtime ledger fixture",
    kind: "model" as const,
    provider: provider.id,
    adapterId: provider.id,
    adapterContractVersion: provider.contractVersion,
    adapterFingerprint: provider.fingerprint,
    authKind: "api_key" as const,
    config: {
      accountId: "runtime-ledger",
      connectionKind: "model",
      destination: null,
      modelId: "fake-model",
    },
    dataProcessingCeiling: options.dataClassCeiling ?? ("public-only" as const),
  };
  const connection = await admin.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.connections.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      credential: "fake-api-key",
      vaultOperationId: randomUUID(),
      definitionJson: npSerializeAgentStudioConnectionDefinitionV1(definition),
      definitionHash: await npDigestAgentStudioConnectionDefinitionV1(definition),
    },
  });
  const [operation] = await f.db
    .select()
    .from(npAgentConnectionOperations)
    .where(eq(npAgentConnectionOperations.connectionId, connection.resourceId))
    .limit(1);
  if (!operation) throw new Error("Fixture activation operation missing");
  await connections.processOperation({ siteId, operationId: operation.id });
  f.advance(2);
  await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision, settings }) => {
    settings.allowedProviderIds = [provider.id];
    settings.defaultPolicyRules.providerDataMaximum = options.dataClassCeiling ?? "public-only";
    settings.defaultPolicyRules.capabilityModes = modes;
    if (options.documentCollection)
      settings.defaultPolicyRules.resources.collections = [options.documentCollection];
    return f.controls.updateInTransaction({
      db,
      siteId,
      expectedRevision: revision,
      actorFingerprint: runtimeFingerprint,
      settings,
    });
  });
  const recipes = runtimeRecipes();
  recipes.recipes[0]!.providerMode = "required";
  recipes.recipes[0]!.instruction = {
    templateId: "runtime.fixture",
    templateVersion: 1,
    digest: instructionDigest,
    text: usageInstruction,
  };
  recipes.recipes[0]!.responseSchema = usageResponseSchema;
  if (options.documentCollection) {
    const recipe = recipes.recipes[0]!;
    recipe.id = "publisher.stale-content";
    recipe.allowedTemplates = ["publisher"];
    recipe.capabilityIds = modes.map((entry) => entry.capabilityId);
    recipe.settingsSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        recipeId: { type: "string", const: "publisher.stale-content", maxLength: 128 },
        recipeVersion: { type: "integer", const: 1, minimum: 1, maximum: 1 },
        collectionSlugs: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
          items: { type: "string", maxLength: 96 },
        },
        staleAfterDays: { type: "integer", minimum: 30, maximum: 3650 },
        candidateLimit: { type: "integer", minimum: 1, maximum: 50 },
        batchSize: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: [
        "batchSize",
        "candidateLimit",
        "collectionSlugs",
        "recipeId",
        "recipeVersion",
        "staleAfterDays",
      ],
    };
  }
  const runtimeOptions = {
    ...f.options,
    recipes,
    deploymentAuthority: { ...f.options.deploymentAuthority, scopes },
  };
  runtimeOptions.frameworkPolicy = {
    ...f.options.frameworkPolicy,
    rules: {
      ...f.options.frameworkPolicy.rules,
      providerDataMaximum: options.dataClassCeiling ?? "public-only",
      capabilityModes: modes,
    },
  };
  const service = createAgentRuntimeServiceV1(runtimeOptions);
  const runtime = runtimeDefinition();
  runtime.modelConnectionId = connection.resourceId;
  runtime.model = "fake-model";
  if (options.documentCollection) {
    runtime.template = "publisher";
    runtime.scopes = scopes;
    runtime.capabilityModes = modes;
    runtime.settings = [
      {
        recipeId: "publisher.stale-content",
        recipeVersion: 1,
        collectionSlugs: [options.documentCollection],
        staleAfterDays: 30,
        candidateLimit: 1,
        batchSize: 1,
      },
    ];
  }
  if (options.agentBudget) runtime.budget = options.agentBudget;
  const created = await service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.configurations.create",
    targetId: null,
    command: { idempotencyKey: randomUUID(), ...npBuildAgentRuntimeDefinitionInputV1(runtime) },
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
  const limits: NpAgentRunLimitsV1 = {
    schemaVersion: "np.agent-run-limits.v1",
    maxAttempts: 2,
    maxProviderCalls: 4,
    maxCapabilityCalls: 2,
    maxInputTokens: 100,
    maxOutputTokens: 100,
    maxCostMicros: 500,
    maxWallClockSeconds: 120,
    ...options.limits,
  };
  const admission = createAgentRuntimeAdmissionV1({ ...runtimeOptions, runLimits: limits });
  const runInput = {
    siteId,
    agentId: created.resourceId,
    expectedVersionId: active.output.versionId as string,
    recipeId: runtime.settings[0]!.recipeId,
    idempotencyKey: randomUUID(),
  };
  const admitted = await admission.admit(runInput);
  const verifyRequest =
    options.verifier === "absent"
      ? undefined
      : (_context: unknown, request: NpAgentProviderRequestCanonicalV1) => {
          if (options.verifier === "throw") throw new Error("fixture verifier unavailable");
          return (
            options.verifier !== "reject" &&
            request.instruction.digest === instructionDigest &&
            request.instruction.text === usageInstruction &&
            request.trustedContext.length === 0 &&
            request.untrustedEvidence.length === 0 &&
            request.classificationManifestDigest === runtimeFingerprint
          );
        };
  const usage = createAgentRuntimeUsageV1({
    admission,
    ambiguityWindowSeconds: 60,
    verifyRequest,
    now: f.options.now,
  });
  const request = (overrides: Partial<NpAgentProviderRequestCanonicalV1> = {}) =>
    admission.withCurrentRun(
      { siteId, runId: overrides.runId ?? admitted.runId },
      async (context) => {
        const { run, connection: current, connectionSnapshot: snapshot, pricing } = context;
        if (
          !current ||
          !snapshot ||
          !pricing ||
          !current.activeSecretVersionId ||
          !current.credentialVersion
        )
          throw new Error("Fixture provider evidence missing");
        return {
          schemaVersion: "np.agent-provider-request.v1",
          siteId,
          providerCallId: randomUUID(),
          runId: run.id,
          sequence: 1,
          retryOfId: null,
          idempotencyKey: randomUUID(),
          connection: {
            id: current.id,
            configSnapshotId: snapshot.id,
            configVersion: snapshot.version,
            configHash: snapshot.configHash,
            secretVersionId: current.activeSecretVersionId,
            credentialVersion: current.credentialVersion,
            adapterId: snapshot.adapterId,
            adapterContractVersion: snapshot.adapterContractVersion,
            adapterFingerprint: snapshot.adapterFingerprint,
          },
          provider: current.provider,
          model: "fake-model",
          recipe: {
            id: "operator.worker-not-draining",
            version: 1,
            fingerprint: run.recipeFingerprint!,
          },
          task: "interactive-capability",
          instruction: {
            templateId: run.instructionTemplateId!,
            templateVersion: run.instructionTemplateVersion!,
            digest: run.instructionDigest!,
            classification: classification(run.instructionDigest!),
            text: usageInstruction,
          },
          trustedContext: [],
          untrustedEvidence: [],
          classificationManifestDigest: runtimeFingerprint,
          responseSchema: usageResponseSchema,
          responseSchemaDigest: run.responseSchemaDigest!,
          responseSchemaClassification: classification(run.responseSchemaDigest!),
          tools: [],
          limits: { maxInputTokens: 10, maxOutputTokens: 10, timeoutSeconds: 30 },
          pricing,
          dataClass: "public-only",
          dataClassCeiling: "public-only",
          ...overrides,
        } as NpAgentProviderRequestCanonicalV1;
      },
    );
  const response = async (
    request: NpAgentProviderRequestCanonicalV1,
    outcome: NpAgentProviderResponseCanonicalV1["outcome"],
    decision: NpAgentProviderResponseCanonicalV1["decision"] = null,
  ): Promise<NpAgentProviderResponseCanonicalV1> => ({
    schemaVersion: "np.agent-provider-response.v1",
    siteId,
    runId: request.runId,
    providerCallId: request.providerCallId,
    requestDigest: await npDigestAgentProviderRequestCanonical(request),
    dispatchState: outcome.status === "succeeded" ? "dispatched" : outcome.dispatchState,
    outcome: structuredClone(outcome),
    decision: structuredClone(decision),
    observedAt: f.options.now().toISOString(),
  });
  return {
    ...f,
    usage,
    vault,
    provider,
    providerRegistry,
    admission,
    runInput,
    runId: admitted.runId,
    connectionId: connection.resourceId,
    agentId: created.resourceId,
    runtimeOptions,
    limits,
    request,
    response,
    call: async () => (await f.db.select().from(npAgentProviderCalls))[0]!,
    dispose: async () => {
      connections.dispose();
      vault.dispose();
      await vaultRegistry.shutdown();
    },
  };
}
