import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import {
  npCreateAgentModeratorAssessmentRecipeDefinitionV1,
  npAgentModeratorAssessmentRecipeSetupV1,
} from "../../../packages/core/src/agent-contract/moderator-assessment-recipe-contract.js";
import { npRequireAgentRecipeRegistryCanonical } from "../../../packages/core/src/agent-contract/canonical-recipe-registry.js";
import {
  npAgentDisabledGatewaySettingsV1,
  type NpAgentModerationDecisionV1,
  type NpAgentProviderInvokeOutcomeV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { npRequireAgentModeratorAssessmentEvidenceV1 } from "../../../packages/core/src/agent-contract/moderator-assessment-contract.js";
import { createAgentModeratorAssessmentSourceV1 } from "../../../packages/core/src/agent/moderator-assessment-source.js";
import { npCreateAgentModeratorAssessmentFixtureCorpusV1 } from "../../../packages/core/src/agent/moderator-assessment-fixtures.js";
import { createAgentIncidentAssessmentServiceV1 } from "../../../packages/core/src/agent/incident-assessment-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import {
  createAgentCoreReadCapabilityExecutorsV1,
  createAgentCoreRuntimeDocumentEvidenceReaderV1,
} from "../../../packages/core/src/agent/read-capability-executors.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { moderatorRecipeFixture } from "./agent-moderator-recipe-fixture.js";
import { runtimeDefinition, runtimeFingerprint, siteId } from "./agent-runtime-service-fixture.js";

/** Reuses actual source writes/collectors; a separately installed read-only Agent owns classification. */
export async function moderatorAssessmentFixture(
  options: {
    source?: "observations" | "content-combined";
    itemCount?: number;
    recorder?: boolean;
  } = {},
) {
  const f = await moderatorRecipeFixture({
    source: options.source ?? "observations",
    itemCount: options.itemCount,
  });
  // Source seeding leaves its proposal-profile Run queued. Release that Run
  // through the owner before installing this alternative, bounded observer.
  await f.store.cancel({ siteId, runId: f.runId });
  const recipe = await npCreateAgentModeratorAssessmentRecipeDefinitionV1();
  const recipes = npRequireAgentRecipeRegistryCanonical({
    schemaVersion: "np.agent-recipe-registry.v1",
    projection: "registry",
    recipes: [recipe],
  });
  const rules = structuredClone(f.runtimeOptions.frameworkPolicy.rules);
  rules.capabilityModes = structuredClone(npAgentModeratorAssessmentRecipeSetupV1.capabilityModes);
  await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision, settings }) => {
    settings.defaultPolicyRules = structuredClone(rules);
    return f.controls.updateInTransaction({
      db,
      siteId,
      expectedRevision: revision,
      actorFingerprint: runtimeFingerprint,
      settings,
    });
  });
  const runtimeOptions = {
    ...f.runtimeOptions,
    recipes,
    deploymentAuthority: {
      ...f.runtimeOptions.deploymentAuthority,
      scopes: [...npAgentModeratorAssessmentRecipeSetupV1.scopes],
    },
    frameworkPolicy: { ...f.runtimeOptions.frameworkPolicy, rules },
  };
  const runtime = createAgentRuntimeServiceV1(runtimeOptions);
  const definition = runtimeDefinition();
  definition.name = "Read-only semantic moderator";
  definition.template = "moderator";
  definition.autonomy = "observe";
  definition.scopes = [...npAgentModeratorAssessmentRecipeSetupV1.scopes];
  definition.capabilityModes = structuredClone(
    npAgentModeratorAssessmentRecipeSetupV1.capabilityModes,
  );
  definition.settings = [
    { ...npAgentModeratorAssessmentRecipeSetupV1.settings, collectionSlugs: ["discussions"] },
  ];
  definition.modelConnectionId = f.connectionId;
  definition.model = "fake-model";
  definition.budget = structuredClone(npAgentModeratorAssessmentRecipeSetupV1.budget);
  const created = await runtime.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.configurations.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      ...npBuildAgentRuntimeDefinitionInputV1(definition),
      authority: { kind: "user", userId: f.actor.actor.user.id },
    },
  });
  const activated = await runtime.executeAdmin({
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
  const admission = createAgentRuntimeAdmissionV1({ ...runtimeOptions, runLimits: f.limits });
  const runInput = {
    siteId,
    agentId: created.resourceId,
    expectedVersionId: String(activated.output.versionId),
    recipeId: recipe.id,
    idempotencyKey: randomUUID(),
  };
  const admitted = await admission.admit(runInput);
  const hiddenIncidentIds = new Set<string>();
  const incidents = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(84),
    canReadIncident: ({ incident }) => !hiddenIncidentIds.has(incident.id),
    canReadStaffIncident: () => true,
    now: f.options.now,
  });
  const readOptions = {
    incidentService: incidents,
    cursorHmacKey: { id: "semantic-moderator", key: new Uint8Array(32).fill(85) },
    resolveUser: () => f.actor.actor.user,
    resolveBlockSchemas: () => [],
  };
  const reader = createAgentCoreRuntimeDocumentEvidenceReaderV1(readOptions);
  const studio = createAgentIncidentStudioServiceV1({
    reads: incidents.staff,
    cursorHmacKey: new Uint8Array(32).fill(86),
    now: f.options.now,
  });
  const source = createAgentModeratorAssessmentSourceV1({ incidents, documentEvidence: reader });
  const assessments = createAgentIncidentAssessmentServiceV1({ source, incidents });
  const capabilities = createAgentCapabilityAdmissionServiceV1({
    resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
    registry: await createAgentReadCapabilityRegistryV1(
      createAgentCoreReadCapabilityExecutorsV1(readOptions),
    ),
    runtimeAdmission: admission,
    now: f.options.now,
  });
  const context = createAgentRuntimeContextV1({
    admission,
    moderatorAssessmentEvidence: source,
    capabilities: {
      list: capabilities.sourceEntries,
      actionOutcomes: capabilities.runtimeActionOutcomes,
    },
  });
  const store = createAgentRuntimeExecutionStoreV1({ admission, now: f.options.now });
  const usage = createAgentRuntimeUsageV1({
    admission,
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
    ...(options.recorder === false ? {} : { incidentAssessments: assessments }),
    now: f.options.now,
  });
  let beforeResponse: (() => Promise<void>) | null = null;
  let decisionOverride: NpAgentModerationDecisionV1 | null = null;
  const conformanceCases = npCreateAgentModeratorAssessmentFixtureCorpusV1().cases;
  f.providerInvoke.mockImplementation(async (request) => {
    const metadata = request.trustedContext.find((entry) => entry.id === "moderator-assessment");
    if (!metadata) throw new Error("Expected exact assessment metadata");
    const evidence = npRequireAgentModeratorAssessmentEvidenceV1(JSON.parse(metadata.text));
    if (beforeResponse) await beforeResponse();
    const expected = conformanceCases.find(
      (entry) =>
        entry.id ===
        (evidence.truncated || evidence.sources.length === 0
          ? "mas-ko-missing-content"
          : "mas-en-promotional-burst"),
    )!.expected;
    const decision: NpAgentModerationDecisionV1 = decisionOverride ?? {
      ...expected,
      evidenceDigests: evidence.sources.map((entry) => entry.excerptDigest).sort(),
    };
    return {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "succeeded",
      provider: "fake-provider",
      model: "fake-model",
      providerRequestId: null,
      output: { task: "moderation-classification", decision },
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
    } satisfies NpAgentProviderInvokeOutcomeV1;
  });
  return {
    ...f,
    runId: admitted.runId,
    assessmentAdmission: admission,
    assessmentSource: source,
    assessments,
    assessmentExecutor: executor,
    incidents,
    assessmentStudio: studio,
    setIncidentVisibility(incidentId: string, visible: boolean) {
      if (visible) hiddenIncidentIds.delete(incidentId);
      else hiddenIncidentIds.add(incidentId);
    },
    async anotherAssessmentRun() {
      return (await admission.admit({ ...runInput, idempotencyKey: randomUUID() })).runId;
    },
    cancelAssessmentRun(runId = admitted.runId) {
      return store.cancel({ siteId, runId });
    },
    async eventAssessmentRun(eventId: string) {
      const events = createAgentRuntimeEventServiceV1({
        admission,
        deploymentAuthority: runtimeOptions.deploymentAuthority,
        now: f.options.now,
        moderatorCollector: f.runtimeCollector,
      });
      await events.registerTrigger({
        siteId,
        agentId: runInput.agentId,
        expectedVersionId: runInput.expectedVersionId,
        enabled: true,
        trigger: {
          type: "event",
          id: randomUUID(),
          eventKind: "community.content.created",
          filter: { op: "eq", field: "source.kind", value: "community" },
          coalesceSeconds: 0,
        },
      });
      const result = await events.dispatch({ siteId, eventId });
      if (result.runIds.length !== 1)
        throw new Error("Expected one actual Event-triggered assessment Run");
      return result.runIds[0]!;
    },
    beforeResponse(callback: () => Promise<void>) {
      beforeResponse = callback;
    },
    setAssessmentDecision(decision: NpAgentModerationDecisionV1) {
      decisionOverride = decision;
    },
    readAssessment(runId = admitted.runId) {
      return admission.withRunAuthority({ siteId, runId }, (current) => source.read(current));
    },
    async dispose() {
      executor.shutdown();
      context.dispose();
      await provider.shutdown();
      await f.dispose();
      vi.useRealTimers();
    },
  };
}
