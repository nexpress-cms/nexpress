import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentRuns,
  npAgentConnections,
  npAgentConnectionConfigVersions,
  npAgentConnectionSecretVersions,
  npAgentCircuitBreakers,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentRunLimitsCanonical,
  npDigestAgentRunLimitsCanonical,
} from "../agent-contract/canonical-bodies.js";
import {
  npRequireAgentBudgetSnapshotCanonical,
  npDigestAgentBudgetSnapshotCanonical,
} from "../agent-contract/canonical-budget-snapshot.js";
import {
  npRequireAgentRunAdmissionCanonical,
  npDigestAgentRunAdmissionCanonical,
} from "../agent-contract/canonical-run-admission.js";
import {
  npRequireAgentConnectionConfigCanonical,
  npDigestAgentConnectionConfigCanonical,
} from "../agent-contract/canonical-connections.js";
import { npDigestAgentRecipeRegistryCanonical } from "../agent-contract/canonical-recipe-registry.js";
import {
  npResolveAgentBudgetV1,
  npAgentBudgetWindowsV1,
  npSelectAgentModelPricingV1,
  type NpAgentConcreteBudgetV1,
} from "../agent-contract/runtime-budget.js";
import type { NpAgentBudgetV1 } from "../agent-contract/wire-contract.js";
import {
  npRequireAgentRuntimeAdmissionSourcesV1,
  type NpAgentRuntimeSettingsV1,
} from "../agent-contract/runtime-contract.js";
import {
  npDeriveAgentRuntimeAdmissionSourceRefsV1,
  npVerifyAgentRuntimeAdmissionSourcesV1,
} from "./runtime-admission-sources.js";
import {
  canonicalBodyRecord,
  canonicalBodyUuid,
  canonicalBodySiteId,
  canonicalBodyEnum,
} from "../agent-contract/canonical-body-validation.js";
import {
  canonicalRuntimeIdempotencyKey,
  cloneCanonicalRuntimeInput,
} from "../agent-contract/canonical-runtime-primitives.js";
import { npAgentRecipeIds, npAgentProviderDataClassRank } from "../agent-contract/types.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type {
  NpAgentJsonObject,
  NpAgentModelPricingV1,
  NpAgentRecipeId,
  NpAgentRunLimitsV1,
  NpAgentRunAdmissionCanonicalV1,
  NpAgentRunAdmissionConnectionV1,
} from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import {
  npRequireAgentRuntimeVersionV1,
  npResolveAgentRuntimePolicyV1,
  type NpAgentRuntimeVersionEvidenceV1,
  type NpAgentRuntimePolicyEvidenceV1,
  type NpAgentRuntimeServiceOptionsV1,
} from "./runtime-service.js";
import {
  npWithAgentRuntimeControlTransactionV1,
  type NpAgentRuntimeControlsV1,
} from "./runtime-controls.js";
import {
  npMeasureAgentRuntimeBudgetV1,
  npRequireAgentRuntimeUsageKnownV1,
} from "./runtime-budget.js";

type Db = ReturnType<typeof getDb>;
type Run = typeof npAgentRuns.$inferSelect;
type Connection = typeof npAgentConnections.$inferSelect;
type Snapshot = typeof npAgentConnectionConfigVersions.$inferSelect;
function fail(code = "RUNTIME_ADMISSION_DENIED", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Agent runtime admission is unavailable.");
}
function hash(purpose: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(purpose).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
function object(value: object): NpAgentJsonObject {
  return value as unknown as NpAgentJsonObject;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface NpAgentRuntimeAdmissionOptionsV1 {
  deploymentAuthority: NpAgentRuntimeServiceOptionsV1["deploymentAuthority"];
  deploymentBudget: NpAgentBudgetV1;
  frameworkPolicy: NpAgentRuntimeServiceOptionsV1["frameworkPolicy"];
  /** Explicit host hard limits, composed with site/Agent ceilings. */
  runLimits: NpAgentRunLimitsV1;
  controls: NpAgentRuntimeControlsV1;
  now?: () => Date;
}
export interface NpAgentRuntimeRunContextV1 {
  db: Db;
  siteId: string;
  now: Date;
  run: Run;
  evidence: NpAgentRuntimeVersionEvidenceV1;
  settings: NpAgentRuntimeSettingsV1;
  policy: NpAgentRuntimePolicyEvidenceV1;
  siteBudget: NpAgentConcreteBudgetV1;
  agentBudget: NpAgentConcreteBudgetV1;
  connection: Connection | null;
  connectionSnapshot: Snapshot | null;
  pricing: NpAgentModelPricingV1 | null;
  limits: NpAgentRunLimitsV1;
}
export interface NpAgentRuntimeExecutionClaimV1 {
  attempt: number;
  leaseUntil: string;
}
export interface NpAgentRuntimeAdmissionV1 {
  /** Host-only root admission. Event dispatch/manual UI and execution remain their own later slices. */
  admit(input: {
    siteId: string;
    agentId: string;
    expectedVersionId: string;
    recipeId: NpAgentRecipeId;
    idempotencyKey: string;
  }): Promise<{ runId: string; replayed: boolean }>;
  withCurrentRun<T>(
    input: { siteId: string; runId: string; claim?: NpAgentRuntimeExecutionClaimV1 },
    operation: (context: NpAgentRuntimeRunContextV1) => Promise<T>,
  ): Promise<T>;
}

/** Exact reconstruction used by admission, reservations and retained evidence verification. */
export function npRuntimeRunAdmissionBodyV1(run: Run): NpAgentRunAdmissionCanonicalV1 {
  return npRequireAgentRunAdmissionCanonical({
    schemaVersion: "np.agent-run-admission.v1",
    siteId: run.siteId,
    origin: run.origin,
    principalId: run.principalId,
    invocationId: run.invocationId,
    triggerId: run.triggerId,
    agent: { id: run.agentId, versionId: run.agentVersionId, configHash: run.agentConfigHash },
    lineage: {
      rootRunId: run.rootRunId,
      parentRunId: run.parentRunId,
      causalDepth: run.causalDepth,
      causalEventId: run.causalEventId,
      causalActionId: run.causalActionId,
    },
    recipe: {
      id: run.recipeId,
      version: run.recipeVersion,
      fingerprint: run.recipeFingerprint,
      instructionTemplateId: run.instructionTemplateId,
      instructionTemplateVersion: run.instructionTemplateVersion,
      instructionDigest: run.instructionDigest,
      responseSchemaDigest: run.responseSchemaDigest,
      manualInputSchemaDigest: run.manualInputSchemaDigest,
    },
    goal: run.goal,
    eventRef: run.eventRef,
    policyRefs: run.policyRefs,
    runLimitsHash: run.runLimitsHash,
    budgetSnapshotHash: run.budgetSnapshotHash,
    idempotencyKey: run.idempotencyKey,
    connection: run.connectionId
      ? {
          id: run.connectionId,
          configSnapshotId: run.connectionConfigSnapshotId,
          configVersion: run.connectionConfigVersion,
          configHash: run.connectionConfigHash,
          dataClassCeiling: run.providerDataClassCeiling,
          pricingId: run.pricingId,
          pricingVersion: run.pricingVersion,
          pricingFingerprint: run.pricingFingerprint,
          pricingEffectiveAt: run.pricingEffectiveAt?.toISOString(),
        }
      : null,
    admittedAt: run.queuedAt.toISOString(),
    deadlineAt: run.deadlineAt.toISOString(),
  });
}

export function createAgentRuntimeAdmissionV1(
  options: NpAgentRuntimeAdmissionOptionsV1,
): NpAgentRuntimeAdmissionV1 {
  const deploymentBudget = npResolveAgentBudgetV1(options.deploymentBudget);
  const hardLimits = npRequireAgentRunLimitsCanonical(options.runLimits);
  const authority = structuredClone(options.deploymentAuthority);
  const frameworkPolicy = structuredClone(options.frameworkPolicy);
  const nowFn = options.now ?? (() => new Date());
  function resolveRunLimits(
    budget: NpAgentConcreteBudgetV1,
    hasProvider: boolean,
    frozen: NpAgentRunLimitsV1 = hardLimits,
  ): NpAgentRunLimitsV1 {
    if (
      budget.attemptsPerRun === 0 ||
      budget.capabilityCallsPerRun === 0 ||
      (hasProvider && budget.providerCallsPerRun === 0)
    )
      fail("RUNTIME_BUDGET_EXHAUSTED");
    const base = npRequireAgentRunLimitsCanonical(
      Object.fromEntries(
        Object.entries(frozen).map(([key, value]) => [
          key,
          typeof value === "number"
            ? Math.min(value, hardLimits[key as keyof NpAgentRunLimitsV1] as number)
            : value,
        ]),
      ),
    );
    return npRequireAgentRunLimitsCanonical({
      ...base,
      maxAttempts: Math.min(base.maxAttempts, budget.attemptsPerRun),
      maxCapabilityCalls: Math.min(base.maxCapabilityCalls, budget.capabilityCallsPerRun),
      maxProviderCalls: hasProvider
        ? Math.min(base.maxProviderCalls, budget.providerCallsPerRun)
        : 1,
      maxInputTokens: hasProvider ? Math.min(base.maxInputTokens, budget.inputTokensPerRun) : 0,
      maxOutputTokens: hasProvider ? Math.min(base.maxOutputTokens, budget.outputTokensPerRun) : 0,
      maxCostMicros: hasProvider
        ? Math.min(base.maxCostMicros, budget.costMicrosPerDay, budget.costMicrosPerMonth)
        : 0,
    });
  }
  function currentAuthority(evidence: NpAgentRuntimeVersionEvidenceV1) {
    const principal = evidence.principal;
    if (
      principal.authorityKind !== "deployment" ||
      principal.authorityPolicyId !== authority.policyId ||
      principal.authorityFingerprint !== authority.fingerprint ||
      evidence.definition.scopes.some((scope) => !authority.scopes.includes(scope))
    )
      fail("RUNTIME_AUTHORITY_CHANGED");
  }
  async function connectionEvidence(
    db: Db,
    siteId: string,
    evidence: NpAgentRuntimeVersionEvidenceV1,
    settings: NpAgentRuntimeSettingsV1,
    now: Date,
    run?: Run,
  ) {
    const id = evidence.definition.modelConnectionId;
    if (!id) return { connection: null, connectionSnapshot: null, pricing: null, canonical: null };
    const [connection] = await db
      .select()
      .from(npAgentConnections)
      .where(and(eq(npAgentConnections.siteId, siteId), eq(npAgentConnections.id, id)))
      .for("update")
      .limit(1);
    if (
      !connection ||
      connection.kind !== "model" ||
      connection.status !== "ready" ||
      !connection.activeSecretVersionId ||
      !connection.credentialVersion ||
      connection.lastVerifiedConfigVersion !== connection.configVersion ||
      connection.lastVerifiedCredentialVersion !== connection.credentialVersion ||
      !settings.allowedProviderIds.includes(connection.provider)
    )
      fail("RUNTIME_PROVIDER_UNAVAILABLE");
    const [snapshot] = await db
      .select()
      .from(npAgentConnectionConfigVersions)
      .where(
        and(
          eq(npAgentConnectionConfigVersions.siteId, siteId),
          eq(npAgentConnectionConfigVersions.connectionId, id),
          eq(npAgentConnectionConfigVersions.id, connection.activeConfigSnapshotId),
        ),
      )
      .limit(1);
    const [secret] = await db
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(
        and(
          eq(npAgentConnectionSecretVersions.siteId, siteId),
          eq(npAgentConnectionSecretVersions.connectionId, id),
          eq(npAgentConnectionSecretVersions.id, connection.activeSecretVersionId),
        ),
      )
      .limit(1);
    // Connection updates may hold the lock until the credential or pricing expires.
    now = nowFn();
    if (
      !snapshot ||
      snapshot.state !== "active" ||
      snapshot.version !== connection.configVersion ||
      snapshot.configHash !== connection.configHash ||
      snapshot.dataProcessingCeiling !== connection.dataProcessingCeiling ||
      !secret ||
      secret.status !== "active" ||
      secret.version !== connection.credentialVersion ||
      (secret.expiresAt !== null && secret.expiresAt <= now)
    )
      fail("RUNTIME_PROVIDER_UNAVAILABLE");
    const body = npRequireAgentConnectionConfigCanonical({
      schemaVersion: "np.agent-connection-config.v1",
      siteId,
      connectionId: id,
      kind: connection.kind,
      provider: connection.provider,
      adapterId: snapshot.adapterId,
      adapterContractVersion: snapshot.adapterContractVersion,
      adapterFingerprint: snapshot.adapterFingerprint,
      authKind: connection.authKind,
      configVersion: snapshot.version,
      config: snapshot.config,
      pricingCatalog: snapshot.pricingCatalog,
      dataProcessingCeiling: snapshot.dataProcessingCeiling,
    });
    if (
      (await npDigestAgentConnectionConfigCanonical(body)) !== snapshot.configHash ||
      snapshot.pricingCatalogFingerprint !== connection.pricingCatalogFingerprint ||
      serializeAgentCanonicalJson(snapshot.config) !==
        serializeAgentCanonicalJson(connection.config)
    )
      fail("RUNTIME_PROVIDER_UNAVAILABLE");
    const pricing = npSelectAgentModelPricingV1({
      catalog: snapshot.pricingCatalog,
      model: evidence.definition.model!,
      at: now.toISOString(),
    });
    if (
      run &&
      (run.connectionId !== connection.id ||
        run.connectionConfigSnapshotId !== snapshot.id ||
        run.connectionConfigVersion !== snapshot.version ||
        run.connectionConfigHash !== snapshot.configHash ||
        run.pricingId !== pricing.pricingId ||
        run.pricingVersion !== pricing.version ||
        run.pricingFingerprint !== pricing.fingerprint)
    )
      fail("RUNTIME_PROVIDER_CHANGED");
    const canonical: NpAgentRunAdmissionConnectionV1 = {
      id,
      configSnapshotId: snapshot.id,
      configVersion: snapshot.version,
      configHash: snapshot.configHash,
      dataClassCeiling: body.dataProcessingCeiling,
      pricingId: pricing.pricingId,
      pricingVersion: pricing.version,
      pricingFingerprint: pricing.fingerprint,
      pricingEffectiveAt: (run?.pricingEffectiveAt ?? now).toISOString(),
    };
    return { connection, connectionSnapshot: snapshot, pricing, canonical };
  }
  async function breakers(db: Db, siteId: string, agentId: string, connectionId: string | null) {
    const conditions = [
      eq(npAgentCircuitBreakers.scopeKind, "site"),
      and(
        eq(npAgentCircuitBreakers.scopeKind, "agent"),
        eq(npAgentCircuitBreakers.scopeRef, agentId),
      ),
    ];
    if (connectionId)
      conditions.push(
        and(
          eq(npAgentCircuitBreakers.scopeKind, "connection"),
          eq(npAgentCircuitBreakers.scopeRef, connectionId),
        ),
      );
    const [blocked] = await db
      .select({ id: npAgentCircuitBreakers.id })
      .from(npAgentCircuitBreakers)
      .where(
        and(
          eq(npAgentCircuitBreakers.siteId, siteId),
          inArray(npAgentCircuitBreakers.state, ["open", "half_open"]),
          or(...conditions),
        ),
      )
      .limit(1);
    if (blocked) fail("RUNTIME_BREAKER_OPEN");
  }
  async function verifiedRun(
    db: Db,
    siteId: string,
    runId: string,
    settings: NpAgentRuntimeSettingsV1,
    revision: number,
    claim?: NpAgentRuntimeExecutionClaimV1,
  ): Promise<NpAgentRuntimeRunContextV1> {
    if (!UUID.test(runId)) fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
    const [run] = await db
      .select()
      .from(npAgentRuns)
      .where(
        and(
          eq(npAgentRuns.siteId, siteId),
          eq(npAgentRuns.id, runId),
          eq(npAgentRuns.origin, "runtime"),
        ),
      )
      .for("update")
      .limit(1);
    if (!run?.agentId || !run.agentVersionId || !run.runtimeAdmissionSources)
      fail("RUNTIME_RESOURCE_UNAVAILABLE", 404);
    const now = nowFn();
    if (
      !settings.enabled ||
      settings.emergencyPause.paused ||
      run.finishedAt ||
      run.deadlineAt <= now ||
      !["queued", "running", "verifying"].includes(run.state)
    )
      fail();
    if (run.state !== "queued" || claim !== undefined || run.leaseUntil !== null) {
      if (
        !claim ||
        !Number.isSafeInteger(claim.attempt) ||
        claim.attempt !== run.attempt ||
        !run.leaseUntil ||
        claim.leaseUntil !== run.leaseUntil.toISOString() ||
        run.leaseUntil <= now
      )
        fail("RUNTIME_LEASE_LOST");
    }
    await options.controls.requireReadyInTransaction({ db, siteId });
    const evidence = await npRequireAgentRuntimeVersionV1({
      db,
      siteId,
      agentId: run.agentId,
      versionId: run.agentVersionId,
    });
    currentAuthority(evidence);
    const body = npRuntimeRunAdmissionBodyV1(run);
    const limits = npRequireAgentRunLimitsCanonical(run.runLimits);
    const snapshot = npRequireAgentBudgetSnapshotCanonical(run.budgetSnapshot);
    if (
      body.principalId !== evidence.principal.id ||
      body.agent?.configHash !== evidence.version.configHash ||
      (await npDigestAgentRunAdmissionCanonical(body)) !== run.admissionFingerprint ||
      (await npDigestAgentRunLimitsCanonical(limits)) !== run.runLimitsHash ||
      (await npDigestAgentBudgetSnapshotCanonical(snapshot)) !== run.budgetSnapshotHash ||
      snapshot.siteId !== siteId ||
      snapshot.agentId !== evidence.agent.id ||
      snapshot.principalId !== evidence.principal.id ||
      serializeAgentCanonicalJson(snapshot.limits) !== serializeAgentCanonicalJson(limits)
    )
      fail("RUNTIME_ADMISSION_INVALID");
    const sources = await npVerifyAgentRuntimeAdmissionSourcesV1({
      sources: run.runtimeAdmissionSources,
      admission: body,
      budgetSnapshot: snapshot,
    });
    if (
      snapshot.sourceRefs.find((ref) => ref.kind === "agent")?.version !== evidence.version.version
    )
      fail("RUNTIME_ADMISSION_INVALID");
    const recipe = evidence.registry.recipes.find(
      (entry) => entry.id === run.recipeId && entry.version === run.recipeVersion,
    );
    if (
      !recipe ||
      !evidence.definition.settings.some((entry) => entry.recipeId === recipe.id) ||
      (await npDigestAgentRecipeRegistryCanonical(
        { ...evidence.registry, projection: "definition", recipes: [recipe] },
        evidence.registry.recipes,
      )) !== run.recipeFingerprint
    )
      fail("RUNTIME_ADMISSION_INVALID");
    if (recipe.task !== "interactive-capability") fail("RUNTIME_TARGET_ADMISSION_UNAVAILABLE");
    if (
      run.responseSchemaDigest !== hash("np.agent-runtime-schema.v1", recipe.responseSchema) ||
      run.manualInputSchemaDigest !==
        (recipe.manualInputSchema
          ? hash("np.agent-runtime-schema.v1", recipe.manualInputSchema)
          : null) ||
      run.instructionTemplateId !== (recipe.instruction?.templateId ?? null) ||
      run.instructionTemplateVersion !== (recipe.instruction?.templateVersion ?? null) ||
      run.instructionDigest !== (recipe.instruction?.digest ?? null)
    )
      fail("RUNTIME_ADMISSION_INVALID");
    const provider =
      recipe.providerMode === "forbidden"
        ? { connection: null, connectionSnapshot: null, pricing: null, canonical: null }
        : await connectionEvidence(db, siteId, evidence, settings, now, run);
    await breakers(db, siteId, evidence.agent.id, provider.connection?.id ?? null);
    const currentDataClass = provider.canonical?.dataClassCeiling;
    const frozenDataClass = body.connection?.dataClassCeiling;
    const effectiveDataClass =
      currentDataClass && frozenDataClass
        ? npAgentProviderDataClassRank[currentDataClass] <
          npAgentProviderDataClassRank[frozenDataClass]
          ? currentDataClass
          : frozenDataClass
        : undefined;
    const policy = await npResolveAgentRuntimePolicyV1({
      db,
      siteId,
      evidence,
      settings,
      settingsRevision: revision,
      frozenRefs: body.policyRefs,
      frozenSources: sources,
      frameworkPolicy,
      providerDataMaximum: effectiveDataClass,
    });
    const siteBudget = npResolveAgentBudgetV1(sources.deploymentBudget, [
      sources.siteBudget,
      deploymentBudget,
      settings.budgetCeiling,
    ]);
    const agentBudget = npResolveAgentBudgetV1(sources.deploymentBudget, [
      sources.siteBudget,
      deploymentBudget,
      settings.budgetCeiling,
      evidence.definition.budget,
    ]);
    const resolvedLimits = resolveRunLimits(agentBudget, provider.connection !== null, limits);
    if (
      run.attempt > resolvedLimits.maxAttempts ||
      nowFn().getTime() >= run.queuedAt.getTime() + resolvedLimits.maxWallClockSeconds * 1000
    )
      fail("RUNTIME_ADMISSION_DENIED");
    return {
      db,
      siteId,
      now: nowFn(),
      run,
      evidence,
      settings,
      policy,
      siteBudget,
      agentBudget,
      connection: provider.connection,
      connectionSnapshot: provider.connectionSnapshot,
      pricing: provider.pricing,
      limits: resolvedLimits,
    };
  }
  return {
    withCurrentRun: (input, operation) => {
      npAssertAgentPreviewEffectsAllowed();
      const keys = ["siteId", "runId"];
      const row = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(input, "agent.runtime.run", 4096),
        "agent.runtime.run",
        [...keys, "claim"],
        keys,
        { seen: new WeakSet<object>() },
      );
      let claim: NpAgentRuntimeExecutionClaimV1 | undefined;
      if (row.claim !== undefined) {
        const value = canonicalBodyRecord(
          row.claim,
          "agent.runtime.claim",
          ["attempt", "leaseUntil"],
          ["attempt", "leaseUntil"],
          { seen: new WeakSet<object>() },
        );
        if (
          typeof value.attempt !== "number" ||
          !Number.isSafeInteger(value.attempt) ||
          value.attempt < 1 ||
          typeof value.leaseUntil !== "string" ||
          !Number.isFinite(Date.parse(value.leaseUntil)) ||
          new Date(value.leaseUntil).toISOString() !== value.leaseUntil
        )
          fail("RUNTIME_LEASE_LOST");
        claim = { attempt: value.attempt, leaseUntil: value.leaseUntil };
      }
      input = {
        siteId: canonicalBodySiteId(row.siteId, "agent.runtime.siteId"),
        runId: canonicalBodyUuid(row.runId, "agent.runtime.runId"),
        ...(claim ? { claim } : {}),
      };
      return npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ db, settings, revision }) =>
          (async () => {
            const context = await verifiedRun(
              db,
              input.siteId,
              input.runId,
              settings,
              revision,
              input.claim,
            );
            if (context.run.leaseUntil && context.run.leaseUntil <= nowFn())
              fail("RUNTIME_LEASE_LOST");
            const result = await operation(context);
            const finished = nowFn();
            if (
              (context.run.leaseUntil && context.run.leaseUntil <= finished) ||
              context.run.deadlineAt <= finished ||
              finished.getTime() >=
                context.run.queuedAt.getTime() + context.limits.maxWallClockSeconds * 1000
            )
              fail("RUNTIME_LEASE_LOST");
            return result;
          })(),
      );
    },
    admit: (input) => {
      npAssertAgentPreviewEffectsAllowed();
      const keys = ["siteId", "agentId", "expectedVersionId", "recipeId", "idempotencyKey"];
      const row = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(input, "agent.runtime.admit", 4096),
        "agent.runtime.admit",
        keys,
        keys,
        { seen: new WeakSet<object>() },
      );
      input = {
        siteId: canonicalBodySiteId(row.siteId, "agent.runtime.siteId"),
        agentId: canonicalBodyUuid(row.agentId, "agent.runtime.agentId"),
        expectedVersionId: canonicalBodyUuid(row.expectedVersionId, "agent.runtime.versionId"),
        recipeId: canonicalBodyEnum<NpAgentRecipeId>(
          row.recipeId,
          "agent.runtime.recipeId",
          new Set(npAgentRecipeIds),
        ),
        idempotencyKey: canonicalRuntimeIdempotencyKey(
          row.idempotencyKey,
          "agent.runtime.idempotencyKey",
        ),
      };
      return npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ db: transaction, settings, revision }) => {
          const db = transaction;
          const evidence = await npRequireAgentRuntimeVersionV1({
            db,
            siteId: input.siteId,
            agentId: input.agentId,
            versionId: input.expectedVersionId,
          });
          currentAuthority(evidence);
          const [previous] = await db
            .select()
            .from(npAgentRuns)
            .where(
              and(
                eq(npAgentRuns.siteId, input.siteId),
                eq(npAgentRuns.origin, "runtime"),
                eq(npAgentRuns.principalId, evidence.principal.id),
                eq(npAgentRuns.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1);
          if (previous) {
            if (
              previous.agentVersionId !== evidence.version.id ||
              previous.recipeId !== input.recipeId
            )
              fail("IDEMPOTENCY_KEY_REUSED");
            if (
              (await npDigestAgentRunAdmissionCanonical(npRuntimeRunAdmissionBodyV1(previous))) !==
              previous.admissionFingerprint
            )
              fail("RUNTIME_ADMISSION_INVALID");
            return { runId: previous.id, replayed: true };
          }
          if (!settings.enabled || settings.emergencyPause.paused) fail("RUNTIME_PAUSED");
          await options.controls.requireReadyInTransaction({ db, siteId: input.siteId });
          let now = nowFn();
          const recipe = evidence.registry.recipes.find((entry) => entry.id === input.recipeId);
          if (
            !recipe ||
            !evidence.definition.settings.some((branch) => branch.recipeId === recipe.id)
          )
            fail("RUNTIME_RECIPE_UNAVAILABLE");
          if (recipe.task !== "interactive-capability")
            fail("RUNTIME_TARGET_ADMISSION_UNAVAILABLE");
          const provider =
            recipe.providerMode === "forbidden"
              ? { connection: null, connectionSnapshot: null, pricing: null, canonical: null }
              : await connectionEvidence(db, input.siteId, evidence, settings, now);
          now = provider.canonical ? new Date(provider.canonical.pricingEffectiveAt) : nowFn();
          if (recipe.providerMode === "required" && !provider.connection)
            fail("RUNTIME_PROVIDER_UNAVAILABLE");
          if (provider.connection)
            await npRequireAgentRuntimeUsageKnownV1({ db, siteId: input.siteId });
          await breakers(db, input.siteId, evidence.agent.id, provider.connection?.id ?? null);
          const policy = await npResolveAgentRuntimePolicyV1({
            db,
            siteId: input.siteId,
            evidence,
            settings,
            settingsRevision: revision,
            providerDataMaximum: provider.canonical?.dataClassCeiling,
            frameworkPolicy,
          });
          if (provider.canonical)
            provider.canonical.dataClassCeiling = policy.effective.providerDataMaximum;
          const sources = npRequireAgentRuntimeAdmissionSourcesV1({
            schemaVersion: "np.agent-runtime-admission-sources.v1",
            frameworkPolicy: {
              schemaVersion: "np.agent-policy.v1",
              instructions: "",
              rules: frameworkPolicy.rules,
            },
            frameworkPolicyVersion: frameworkPolicy.version,
            sitePolicy: {
              schemaVersion: "np.agent-policy.v1",
              instructions: "",
              rules: settings.defaultPolicyRules,
            },
            deploymentBudget,
            siteBudget: settings.budgetCeiling,
          });
          const sourceRefs = await npDeriveAgentRuntimeAdmissionSourceRefsV1({
            sources,
            settingsRevision: revision,
          });
          const siteBudget = npResolveAgentBudgetV1(deploymentBudget, [settings.budgetCeiling]);
          const agentBudget = npResolveAgentBudgetV1(deploymentBudget, [
            settings.budgetCeiling,
            evidence.definition.budget,
          ]);
          const counters = await npMeasureAgentRuntimeBudgetV1({ db, siteId: input.siteId, now });
          const agentCounters = await npMeasureAgentRuntimeBudgetV1({
            db,
            siteId: input.siteId,
            agentId: evidence.agent.id,
            now,
          });
          for (const [budget, count] of [
            [siteBudget, counters],
            [agentBudget, agentCounters],
          ] as const) {
            if (
              count.concurrentRuns >= budget.maxConcurrentRuns ||
              count.runsRollingHour >= budget.runsPerHour
            )
              fail("RUNTIME_BUDGET_EXHAUSTED");
          }
          const runLimits = resolveRunLimits(agentBudget, provider.connection !== null);
          const fingerprint = await npDigestAgentRecipeRegistryCanonical(
            { ...evidence.registry, projection: "definition", recipes: [recipe] },
            evidence.registry.recipes,
          );
          const recipeRef = { id: recipe.id, version: recipe.version, fingerprint };
          const snapshot = npRequireAgentBudgetSnapshotCanonical({
            schemaVersion: "np.agent-budget-snapshot.v1",
            siteId: input.siteId,
            principalId: evidence.principal.id,
            agentId: evidence.agent.id,
            recipe: recipeRef,
            capturedAt: now.toISOString(),
            sourceRefs: [
              {
                kind: "agent",
                id: evidence.agent.id,
                version: evidence.version.version,
                digest: evidence.version.configHash,
              },
              { kind: "recipe", id: recipe.id, version: recipe.version, digest: fingerprint },
              ...sourceRefs.budgetSourceRefs,
            ].sort((a, b) => a.kind.localeCompare(b.kind)),
            limits: runLimits,
            counters,
            windows: npAgentBudgetWindowsV1(now.toISOString()),
            reservation: {
              runs: 1,
              providerCalls: 0,
              inputTokens: 0,
              outputTokens: 0,
              costMicros: 0,
            },
          });
          const id = randomUUID();
          const deadlineAt = new Date(now.getTime() + runLimits.maxWallClockSeconds * 1000);
          const body = npRequireAgentRunAdmissionCanonical({
            schemaVersion: "np.agent-run-admission.v1",
            siteId: input.siteId,
            origin: "runtime",
            principalId: evidence.principal.id,
            invocationId: null,
            triggerId: null,
            agent: {
              id: evidence.agent.id,
              versionId: evidence.version.id,
              configHash: evidence.version.configHash,
            },
            lineage: {
              rootRunId: id,
              parentRunId: null,
              causalDepth: 0,
              causalEventId: null,
              causalActionId: null,
            },
            recipe: {
              ...recipeRef,
              instructionTemplateId: recipe.instruction?.templateId ?? null,
              instructionTemplateVersion: recipe.instruction?.templateVersion ?? null,
              instructionDigest: recipe.instruction?.digest ?? null,
              responseSchemaDigest: hash("np.agent-runtime-schema.v1", recipe.responseSchema),
              manualInputSchemaDigest: recipe.manualInputSchema
                ? hash("np.agent-runtime-schema.v1", recipe.manualInputSchema)
                : null,
            },
            goal: `Run ${recipe.id}`,
            eventRef: null,
            policyRefs: policy.refs,
            runLimitsHash: await npDigestAgentRunLimitsCanonical(runLimits),
            budgetSnapshotHash: await npDigestAgentBudgetSnapshotCanonical(snapshot),
            idempotencyKey: input.idempotencyKey,
            connection: provider.canonical,
            admittedAt: now.toISOString(),
            deadlineAt: deadlineAt.toISOString(),
          });
          const admissionFingerprint = await npDigestAgentRunAdmissionCanonical(body);
          await db.insert(npAgentRuns).values({
            id,
            siteId: input.siteId,
            origin: "runtime",
            agentId: evidence.agent.id,
            agentVersionId: evidence.version.id,
            agentConfigHash: evidence.version.configHash,
            principalId: evidence.principal.id,
            admissionFingerprint,
            rootRunId: id,
            causalDepth: 0,
            recipeId: recipe.id,
            recipeVersion: recipe.version,
            recipeFingerprint: fingerprint,
            instructionTemplateId: body.recipe!.instructionTemplateId,
            instructionTemplateVersion: body.recipe!.instructionTemplateVersion,
            instructionDigest: body.recipe!.instructionDigest,
            responseSchemaDigest: body.recipe!.responseSchemaDigest,
            manualInputSchemaDigest: body.recipe!.manualInputSchemaDigest,
            state: "queued",
            goal: body.goal,
            policyRefs: policy.refs.map(object),
            runtimeAdmissionSources: sources,
            runLimits,
            runLimitsHash: body.runLimitsHash,
            budgetSnapshot: object(snapshot),
            budgetSnapshotHash: body.budgetSnapshotHash,
            idempotencyKey: input.idempotencyKey,
            attempt: 1,
            connectionId: provider.canonical?.id,
            connectionConfigSnapshotId: provider.canonical?.configSnapshotId,
            connectionConfigVersion: provider.canonical?.configVersion,
            connectionConfigHash: provider.canonical?.configHash,
            providerDataClassCeiling: provider.canonical?.dataClassCeiling,
            pricingId: provider.canonical?.pricingId,
            pricingVersion: provider.canonical?.pricingVersion,
            pricingFingerprint: provider.canonical?.pricingFingerprint,
            pricingEffectiveAt: provider.canonical ? now : null,
            usage: {
              providerCalls: 0,
              capabilityCalls: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              costMicros: 0,
            },
            queuedAt: now,
            deadlineAt,
          });
          await db.insert(npAuditEvents).values({
            actorKind: "system",
            siteId: input.siteId,
            action: "agent.runtime.admitted",
            targetType: "agent-run",
            targetId: id,
            payload: { runId: id, actorFingerprint: authority.fingerprint, admissionFingerprint },
            createdAt: now,
          });
          return { runId: id, replayed: false };
        },
      );
    },
  };
}
