import type { NpAgentRecipeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import {
  npCreateAgentGuardianAssessmentRecipeDefinitionV1,
  npCreateAgentGuardianAssessmentRecipeSetupV1,
  type NpAgentGuardianAssessmentRecipeIdV1,
} from "../../../packages/core/src/agent-contract/guardian-assessment-recipe-contract.js";
import {
  npRequireAgentGuardianAssessmentEvidenceV1,
  type NpAgentGuardianAssessmentEvidenceV1,
} from "../../../packages/core/src/agent-contract/guardian-assessment-contract.js";
import {
  npAgentDisabledGatewaySettingsV1,
  type NpAgentGuardianDecisionV1,
  type NpAgentProviderInvokeOutcomeV1,
  type NpAgentProviderRequestCanonicalV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { createAgentGuardianAssessmentSourceV1 } from "../../../packages/core/src/agent/guardian-assessment-source.js";
import { createAgentGuardianIncidentAssessmentServiceV1 } from "../../../packages/core/src/agent/guardian-incident-assessment-service.js";
import { createAgentGuardianSecurityObservationServiceV1 } from "../../../packages/core/src/agent/guardian-security-observation.js";
import { createAgentGuardianObservationServiceV1 } from "../../../packages/core/src/agent/guardian-observation-service.js";
import { createAgentGuardianSessionObservationServiceV1 } from "../../../packages/core/src/agent/guardian-session-observation.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { eq } from "drizzle-orm";
import { createAgentGuardianRuntimeObservationServiceV1 } from "../../../packages/core/src/agent/guardian-runtime-observation.js";
import {
  resetAgentGuardianRuntimeObserverV1,
  setAgentGuardianRuntimeObserverV1,
} from "../../../packages/core/src/agent/guardian-runtime-observer.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { npParseAgentStoredProviderConnectionConfigV1 } from "../../../packages/core/src/agent/provider-auth-contract.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { grantSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import {
  resetSiteAuthorityObserverV1,
  setSiteAuthorityObserverV1,
} from "../../../packages/core/src/sites/authority-observer.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { runtimeBudget, runtimeDefinition, siteId } from "./agent-runtime-service-fixture.js";
import { seedUser } from "./harness.js";

/** Actual committed source owners and Runtime journals; the only provider is the in-process fake. */
export async function guardianAssessmentFixture(
  options: {
    recipeId?: NpAgentGuardianAssessmentRecipeIdV1;
    recorder?: boolean;
    source?: boolean;
    runtimeSource?: boolean;
    credentialSettings?: Partial<
      Extract<NpAgentRecipeSettingsV1, { recipeId: "guardian.credential-stuffing" }>
    >;
    failureSpacingSeconds?: number;
    distinctAccounts?: boolean;
    unsignedRequests?: boolean;
    rotatedRequestKey?: boolean;
    rateOnly?: boolean;
    sessionSource?: boolean;
  } = {},
) {
  const recipeId = options.recipeId ?? "guardian.credential-stuffing";
  const recipe = await npCreateAgentGuardianAssessmentRecipeDefinitionV1(recipeId);
  const setup = npCreateAgentGuardianAssessmentRecipeSetupV1(recipeId);
  if (setup.settings.recipeId === "guardian.credential-stuffing")
    Object.assign(setup.settings, options.credentialSettings);
  const definition = runtimeDefinition();
  definition.name = "Read-only Guardian observer";
  definition.template = "guardian";
  definition.autonomy = setup.autonomy;
  definition.scopes = [...setup.scopes];
  definition.capabilityModes = structuredClone(setup.capabilityModes);
  definition.settings = [setup.settings];
  definition.budget = setup.budget;
  let beforeResponse: ((evidence: NpAgentGuardianAssessmentEvidenceV1) => Promise<void>) | null =
    null;
  let decisionOverride: NpAgentGuardianDecisionV1 | null = null;
  const providerInvoke = vi.fn(
    async (request: NpAgentProviderRequestCanonicalV1): Promise<NpAgentProviderInvokeOutcomeV1> => {
      const entry = request.trustedContext.find((item) => item.id === "guardian-assessment");
      if (!entry) throw new Error("Expected exact Guardian evidence");
      const evidence = npRequireAgentGuardianAssessmentEvidenceV1(JSON.parse(entry.text));
      if (beforeResponse) await beforeResponse(evidence);
      return {
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "succeeded",
        provider: "fake-provider",
        model: "fake-model",
        providerRequestId: null,
        output: {
          task: "guardian-assessment",
          decision: decisionOverride ?? {
            kind: "assessment",
            disposition:
              evidence.truncated || !evidence.sources.length ? "inconclusive" : "consistent",
            confidenceBasisPoints: 6000,
            assessmentCodes:
              evidence.truncated || !evidence.sources.length
                ? ["inconclusive"]
                : recipeId === "guardian.credential-stuffing"
                  ? ["credential-stuffing-pattern"]
                  : ["authorization-probing"],
            evidenceDigests: evidence.sources.map((source) => source.digest).sort(),
            summary: "Read-only synthetic advisory; human review retains authority.",
          },
        },
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
    },
  );
  const f = await runtimeUsageFixture({
    definition,
    recipe,
    delegated: true,
    dataClassCeiling: "sensitive-approved",
    budget: runtimeBudget({
      incidentAnalysesPerFingerprintPerDay: 1,
      incidentAnalysisCooldownSeconds: 60,
    }),
    providerInference: { invoke: providerInvoke },
    ...(options.failureSpacingSeconds ? { limits: { maxWallClockSeconds: 900 } } : {}),
  });
  const now = f.options.now;
  const events = createAgentRuntimeEventServiceV1({
    admission: f.admission,
    deploymentAuthority: f.runtimeOptions.deploymentAuthority,
    now,
  });
  const runtimeSource = options.runtimeSource
    ? createAgentGuardianRuntimeObservationServiceV1({
        receiptKey: { id: "guardian-assessment-runtime", bytes: new Uint8Array(32).fill(86) },
        installedSiteIds: [siteId],
        authorize: async () => {},
        events,
        now,
      })
    : undefined;
  const security = createAgentGuardianSecurityObservationServiceV1({
    actorKey: { id: "guardian-assessment-source", bytes: new Uint8Array(32).fill(83) },
    isInstalledSite: async (id) => id === siteId,
    authorize: async () => {},
    events,
    now,
  });
  const requests = createAgentGuardianObservationServiceV1({
    actorKey: { id: "guardian-assessment-requests", bytes: new Uint8Array(32).fill(82) },
    ...(options.unsignedRequests
      ? {}
      : {
          receiptKey: { id: "guardian-assessment-receipts", bytes: new Uint8Array(32).fill(88) },
        }),
    isInstalledSite: async (id) => id === siteId,
    authorize: async () => {},
    events,
    now,
  });
  let historicalRequestKeyAvailable = true;
  const requestVerifier = options.rotatedRequestKey
    ? createAgentGuardianObservationServiceV1({
        actorKey: { id: "guardian-assessment-requests", bytes: new Uint8Array(32).fill(82) },
        receiptKey: { id: "guardian-assessment-receipts-next", bytes: new Uint8Array(32).fill(89) },
        resolveReceiptKey: (id) =>
          historicalRequestKeyAvailable && id === "guardian-assessment-receipts"
            ? new Uint8Array(32).fill(88)
            : null,
        isInstalledSite: async (id) => id === siteId,
        authorize: async () => {},
        events,
        now,
      })
    : requests;
  let nextNetwork = 1;
  async function seedIncident() {
    f.advance(1);
    if (runtimeSource) {
      // Actual allowed read Actions create the source-only outbox; no hand-written Event/receipt.
      const sourceStore = createAgentRuntimeExecutionStoreV1({ admission: f.admission, now });
      setAgentGuardianRuntimeObserverV1(runtimeSource.observer);
      try {
        for (let index = 0; index < 5; index++) {
          const { runId } = await f.admission.admit({
            ...f.runInput,
            idempotencyKey: randomUUID(),
          });
          const acquired = await sourceStore.claim({ siteId, runId });
          if (!acquired.claim) throw new Error("Expected actual source Run claim");
          await capabilities.invokeRuntime({
            siteId,
            runId,
            claim: acquired.claim,
            sequence: 1,
            request: {
              schemaVersion: "np.agent-invocation-request.v1",
              capabilityId: "incident.list",
              arguments: {
                input: {
                  statuses: [],
                  categories: [],
                  severities: [],
                  updatedAfter: null,
                  limit: 10,
                  cursor: null,
                },
                idempotencyKey: null,
              },
            },
          });
        }
      } finally {
        resetAgentGuardianRuntimeObserverV1();
      }
      await runtimeSource.collect({ siteId, limit: 25 });
      return;
    }
    if (recipeId === "guardian.agent-abuse") {
      const target = await seedUser({ role: "viewer" });
      await grantSiteMembership(siteId, target.userId, "viewer");
      setSiteAuthorityObserverV1(security.authorityObserver);
      try {
        await grantSiteMembership(siteId, target.userId, "admin", {
          actor: { kind: "staff", userId: f.actor.actor.user.id },
        });
      } finally {
        resetSiteAuthorityObserverV1();
      }
      return;
    }
    const networkAddress = `192.0.2.${nextNetwork++}`;
    let session: { id: string; userId: string; createdAt: Date } | undefined;
    if (options.sessionSource) {
      const principal = await seedUser({ email: "private-fixture@example.test" });
      [session] = await f.db
        .select()
        .from(npSessions)
        .where(eq(npSessions.userId, principal.userId));
      if (!session) throw new Error("Expected actual source browser session");
      f.advance((session.createdAt.getTime() + 10 - now().getTime()) / 1000);
    }
    const spanMs = (options.failureSpacingSeconds ?? 0) * 4000;
    const remainingWindowMs = 600_000 - (now().getTime() % 600_000);
    if (spanMs >= remainingWindowMs) f.advance(remainingWindowMs / 1000 + 1);
    // All five actual writes use one closed source window; raw identity never becomes model evidence.
    for (let index = 0; index < 5; index++) {
      if (index) f.advance(options.failureSpacingSeconds ?? 0);
      const base = {
        siteId,
        observationId: randomUUID(),
        occurredAt: session
          ? new Date(session.createdAt.getTime() - 5000 + index).toISOString()
          : now().toISOString(),
        networkAddress,
      };
      await requests.observe(
        options.rateOnly
          ? { ...base, kind: "rate-limited", routeFamily: "staff-auth" }
          : {
              ...base,
              kind: "login-failed",
              audience: "staff",
              loginIdentifier: options.distinctAccounts
                ? `private-fixture-${index}@example.test`
                : "private-fixture@example.test",
            },
      );
    }
    if (session)
      await createAgentGuardianSessionObservationServiceV1({
        actorKey: { id: "guardian-assessment-requests", bytes: new Uint8Array(32).fill(82) },
        isInstalledSite: async (id) => id === siteId,
        authorize: async () => {},
        events,
        now,
      }).observe({
        siteId,
        observationId: randomUUID(),
        occurredAt: now().toISOString(),
        networkAddress,
        audience: "staff",
        principalId: session.userId,
        sessionFamilyId: session.id,
      });
  }
  const hidden = new Set<string>();
  const incidents = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(84),
    now,
    canReadIncident: ({ incident }) => !hidden.has(incident.id),
    canReadStaffIncident: () => true,
  });
  const source = createAgentGuardianAssessmentSourceV1({
    incidents,
    securityObservations: security,
    requestObservations: requestVerifier,
    ...(runtimeSource ? { runtimeObservations: runtimeSource } : {}),
  });
  const assessments = createAgentGuardianIncidentAssessmentServiceV1({ source, incidents });
  const capabilities = createAgentCapabilityAdmissionServiceV1({
    registry: await createAgentReadCapabilityRegistryV1(
      createAgentCoreReadCapabilityExecutorsV1({
        incidentService: incidents,
        cursorHmacKey: { id: "guardian-assessment", key: new Uint8Array(32).fill(85) },
        resolveUser: () => f.actor.actor.user,
        resolveBlockSchemas: () => [],
      }),
    ),
    runtimeAdmission: f.admission,
    resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
    now,
  });
  await seedIncident();
  const contextOptions = {
    admission: f.admission,
    ...(options.source === false ? {} : { guardianAssessmentEvidence: source }),
    capabilities: {
      list: capabilities.sourceEntries,
      actionOutcomes: capabilities.runtimeActionOutcomes,
    },
  };
  const context = createAgentRuntimeContextV1(contextOptions);
  const usage = createAgentRuntimeUsageV1({
    admission: f.admission,
    ambiguityWindowSeconds: 300,
    verifyRequest: context.verifyRequest,
    now,
  });
  const store = createAgentRuntimeExecutionStoreV1({
    admission: f.admission,
    now,
    leaseSeconds: 5,
  });
  const provider = createAgentProviderInferenceRuntimeV1({ registry: f.providerRegistry, now });
  const breakers = createAgentRuntimeBreakersV1({
    failureThreshold: 3,
    windowSeconds: 60,
    cooldownSeconds: 30,
    now,
  });
  const executorOptions = {
    store,
    context,
    usage,
    provider,
    providerRegistry: f.providerRegistry,
    vault: f.vault,
    capabilities,
    breakers,
    ...(options.recorder === false ? {} : { guardianIncidentAssessments: assessments }),
    now,
  };
  const executor = createAgentRuntimeExecutorV1(executorOptions);
  const extraContexts: Array<typeof context> = [];
  const extraExecutors: Array<typeof executor> = [];
  return {
    ...f,
    recipe,
    setup,
    providerInvoke,
    events,
    security,
    requests,
    forgetRequestReceiptKey() {
      historicalRequestKeyAvailable = false;
    },
    runtimeSource,
    incidents,
    source,
    assessments,
    context,
    usage,
    store,
    executor,
    seedIncident,
    beforeResponse(callback: NonNullable<typeof beforeResponse>) {
      beforeResponse = callback;
    },
    setDecision(decision: NpAgentGuardianDecisionV1) {
      decisionOverride = decision;
    },
    setVisibility(id: string, visible: boolean) {
      if (visible) hidden.delete(id);
      else hidden.add(id);
    },
    read(runId = f.runId) {
      return f.admission.withRunAuthority({ siteId, runId }, (current) => source.read(current));
    },
    async anotherRun() {
      return (await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() })).runId;
    },
    async prepare(runId = f.runId, sequence = 1, retryOfId: string | null = null) {
      return context.prepare({
        siteId,
        runId,
        providerCallId: randomUUID(),
        sequence,
        retryOfId,
        idempotencyKey: randomUUID(),
      });
    },
    async completeProviderCall() {
      const request = await context.prepare({
        siteId,
        runId: f.runId,
        providerCallId: randomUUID(),
        sequence: 1,
        retryOfId: null,
        idempotencyKey: randomUUID(),
      });
      await usage.reserve({ siteId, runId: f.runId, request });
      const parsed = await f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) => {
        if (!current.connection || !current.connectionSnapshot)
          throw new Error("Expected current fake connection");
        return npParseAgentStoredProviderConnectionConfigV1({
          registry: f.providerRegistry,
          connection: current.connection,
          snapshot: current.connectionSnapshot,
        });
      });
      const lease = await f.vault.leaseProviderCredential({
        siteId,
        secretVersionId: request.connection.secretVersionId,
        use: "runtime",
      });
      try {
        await usage.beginDispatch({ siteId, runId: f.runId, request });
        const response = await provider.invoke({
          request,
          connection: parsed.parsed,
          credentialLease: lease,
        });
        await usage.reconcile({ siteId, providerCallId: request.providerCallId, response });
      } finally {
        lease.dispose();
        context.forget(request.providerCallId);
      }
      return request;
    },
    restart() {
      const restartedContext = createAgentRuntimeContextV1(contextOptions);
      const restartedUsage = createAgentRuntimeUsageV1({
        admission: f.admission,
        ambiguityWindowSeconds: 300,
        verifyRequest: restartedContext.verifyRequest,
        now,
      });
      const restarted = createAgentRuntimeExecutorV1({
        ...executorOptions,
        context: restartedContext,
        usage: restartedUsage,
      });
      extraContexts.push(restartedContext);
      extraExecutors.push(restarted);
      return restarted;
    },
    async dispose() {
      resetSiteAuthorityObserverV1();
      resetAgentGuardianRuntimeObserverV1();
      extraExecutors.forEach((entry) => entry.shutdown());
      extraContexts.forEach((entry) => entry.dispose());
      executor.shutdown();
      context.dispose();
      await provider.shutdown();
      await f.dispose();
    },
  };
}
