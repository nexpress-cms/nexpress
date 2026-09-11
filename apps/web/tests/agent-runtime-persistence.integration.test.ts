import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  npAgents,
  npAgentVersions,
  npAgentPolicies,
  npAgentPrincipals,
  npAgentRuns,
  npAgentTriggers,
  npAgentEvents,
  npAgentCircuitBreakers,
  npAgentUsageDaily,
  npAgentUsageReservations,
  npAgentProviderCalls,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npCreateRuntimePersistenceFixture,
  npRuntimePersistenceConnection,
  npRuntimePersistenceProviderFixture,
  npRuntimePersistenceRun,
  npRuntimePersistenceDigest as digest,
  npRuntimePersistenceAt as at,
  npRuntimePersistenceLater as later,
  npRuntimePersistencePolicy as rules,
} from "./agent-runtime-persistence-fixture.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Runtime persistence foundation", () => {
  beforeAll(ensureMigrated);
  afterEach(truncateAll);
  afterAll(closeTestDb);

  it("installs the runtime table and deferred lifecycle inventory", async () => {
    const db = await getTestDb();
    const result = await db.execute<{ name: string }>(
      sql`select tablename as name from pg_tables where schemaname='public' and tablename in ('np_agents','np_agent_versions','np_agent_policies','np_agent_triggers','np_agent_provider_calls','np_agent_usage_reservations','np_agent_usage_daily','np_agent_circuit_breakers','np_agent_events') order by tablename`,
    );
    expect(result.rows).toHaveLength(9);
    const constraints = await db.execute<{
      name: string;
      deferred: boolean;
      initially: boolean;
      deleteAction: string;
    }>(
      sql`select conname as name, condeferrable as deferred, condeferred as initially, confdeltype as "deleteAction" from pg_constraint where conname in ('np_agents_active_version_fk','np_agents_draft_version_fk','np_agent_runs_causal_event_fk','np_agent_runs_causal_action_fk') order by conname`,
    );
    expect(constraints.rows).toHaveLength(4);
    expect(constraints.rows.every((r) => r.deferred && r.initially && r.deleteAction === "a")).toBe(
      true,
    );
  });

  it("permits an empty suspended runtime draft without relaxing external/active scopes", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    await expect(
      f.db
        .update(npAgentPrincipals)
        .set({ kind: "external" })
        .where(eq(npAgentPrincipals.id, f.principalId)),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentPrincipals)
        .set({ status: "active" })
        .where(eq(npAgentPrincipals.id, f.principalId)),
    ).rejects.toThrow();
    const [principal] = await f.db
      .select()
      .from(npAgentPrincipals)
      .where(eq(npAgentPrincipals.id, f.principalId));
    expect(principal?.scopes).toEqual([]);
  });

  it("binds active and draft version pointers to the same site and Agent", async () => {
    const f = await npCreateRuntimePersistenceFixture(),
      other = await npCreateRuntimePersistenceFixture("runtime-b");
    await expect(
      f.db
        .update(npAgents)
        .set({ draftVersionId: other.versionId })
        .where(eq(npAgents.id, f.agentId)),
    ).rejects.toThrow();
    await expect(
      f.db.update(npAgents).set({ status: "active" }).where(eq(npAgents.id, f.agentId)),
    ).rejects.toThrow();
    await expect(
      f.db.insert(npAgents).values({
        siteId: f.siteId,
        principalId: other.principalId,
        name: "Wrong site",
        template: "operator",
        status: "draft",
      }),
    ).rejects.toThrow();
    await expect(
      f.db.insert(npAgentVersions).values({ ...f.version, id: randomUUID(), version: 2 }),
    ).rejects.toThrow();
  });

  it("keeps one active version while allowing an independent replacement draft", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    await f.db.transaction(async (tx) => {
      await tx
        .update(npAgentVersions)
        .set({ status: "active", activatedAt: at })
        .where(eq(npAgentVersions.id, f.versionId));
      await tx
        .update(npAgents)
        .set({ status: "active", activeVersionId: f.versionId, draftVersionId: null })
        .where(eq(npAgents.id, f.agentId));
      await tx
        .update(npAgentPrincipals)
        .set({ status: "active", scopes: ["site:read"] })
        .where(eq(npAgentPrincipals.id, f.principalId));
    });
    await f.db.insert(npAgentVersions).values({ ...f.version, id: randomUUID(), version: 2 });
    await expect(
      f.db
        .insert(npAgentVersions)
        .values({ ...f.version, id: randomUUID(), version: 3, status: "active", activatedAt: at }),
    ).rejects.toThrow();
  });

  it.each([
    { rowVersion: 0 },
    { version: 0 },
    { status: "unknown" },
    { autonomy: "automatic" },
    { policyMode: "ignore-site" },
    { model: "unpaired" },
    { modelConnectionId: randomUUID() },
    { status: "active", activatedAt: null },
    { status: "retired", activatedAt: at, retiredAt: null },
    { recipeRegistryFingerprint: "invalid" },
    { configHash: "invalid" },
  ])("rejects malformed version projection %#", async (change) => {
    const f = await npCreateRuntimePersistenceFixture();
    await expect(
      f.db.update(npAgentVersions).set(change).where(eq(npAgentVersions.id, f.versionId)),
    ).rejects.toThrow();
  });

  it("serializes policy version/active uniqueness separately for site and Agent", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    const policy = {
      siteId: f.siteId,
      version: 1,
      status: "active",
      name: "Policy",
      instructions: "",
      rules,
      contentHash: digest,
      createdAt: at,
      activatedAt: at,
    };
    await f.db.insert(npAgentPolicies).values(policy);
    await expect(f.db.insert(npAgentPolicies).values({ ...policy, version: 2 })).rejects.toThrow();
    await expect(
      f.db.insert(npAgentPolicies).values({ ...policy, status: "draft", activatedAt: null }),
    ).rejects.toThrow();
    await f.db.insert(npAgentPolicies).values({ ...policy, agentId: f.agentId });
    await expect(
      f.db.insert(npAgentPolicies).values({ ...policy, agentId: f.agentId, version: 2 }),
    ).rejects.toThrow();
  });

  it("enforces trigger kind columns, version identity and logical deduplication", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    const trigger = {
      siteId: f.siteId,
      agentId: f.agentId,
      agentVersionId: f.versionId,
      kind: "manual",
      filter: {},
      filterHash: digest,
      coalesceSeconds: 0,
      enabled: false,
    };
    await f.db.insert(npAgentTriggers).values(trigger);
    await expect(f.db.insert(npAgentTriggers).values(trigger)).rejects.toThrow();
    for (const change of [
      { kind: "event" },
      { kind: "event", eventType: "unregistered" },
      { kind: "schedule", cron: "* * * * *", catchUp: "once", enabled: true },
      { eventType: "agent.run.changed" },
      { coalesceSeconds: -1 },
      { filterHash: "invalid" },
    ]) {
      await expect(
        f.db.insert(npAgentTriggers).values({ ...trigger, ...change }),
      ).rejects.toThrow();
    }
    await f.db.insert(npAgentTriggers).values({
      ...trigger,
      kind: "schedule",
      cron: "* * * * *",
      catchUp: "skip",
      nextRunAt: later,
      enabled: true,
    });
  });

  it.each([
    { agentId: null },
    { agentVersionId: null },
    { agentConfigHash: null },
    { recipeId: null },
    { recipeVersion: null },
    { recipeFingerprint: null },
    { responseSchemaDigest: null },
    { runtimeAdmissionSources: null },
    { connectionId: randomUUID() },
    { pricingId: "unpaired" },
    { instructionTemplateId: "unpaired" },
    { instructionTemplateVersion: 1 },
    { manualInputSchemaDigest: "invalid" },
    { leaseUntil: later },
    { deadlineAt: new Date(at.getTime() + 86401000) },
  ])("rejects a partial or inconsistent runtime admission %#", async (change) => {
    const f = await npCreateRuntimePersistenceFixture();
    await expect(
      f.db.insert(npAgentRuns).values(npRuntimePersistenceRun(f, change)),
    ).rejects.toThrow();
  });

  it("supports provider-optional instruction evidence without a connection", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    await f.db.insert(npAgentRuns).values(npRuntimePersistenceRun(f));
    await f.db.insert(npAgentRuns).values(
      npRuntimePersistenceRun(f, {
        instructionTemplateId: "operator.worker-not-draining",
        instructionTemplateVersion: 1,
        instructionDigest: digest,
      }),
    );
  });

  it("rejects cross-site run/version references and copied principal ownership", async () => {
    const f = await npCreateRuntimePersistenceFixture(),
      other = await npCreateRuntimePersistenceFixture("runtime-b");
    for (const change of [
      { agentId: other.agentId },
      { agentVersionId: other.versionId },
      { principalId: other.principalId },
      { agentConfigHash: "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
    ]) {
      await expect(
        f.db.insert(npAgentRuns).values(npRuntimePersistenceRun(f, change)),
      ).rejects.toThrow();
    }
    await expect(
      f.db.insert(npAgentRuns).values(npRuntimePersistenceRun(f, { causalEventId: randomUUID() })),
    ).rejects.toThrow();
  });

  it("rejects a same-site connection/config mismatch before a reservation exists", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    const first = await npRuntimePersistenceConnection(f),
      second = await npRuntimePersistenceConnection(f);
    await expect(
      f.db.insert(npAgentRuns).values(
        npRuntimePersistenceRun(f, {
          connectionId: first.connectionId,
          connectionConfigSnapshotId: second.configId,
          connectionConfigVersion: 1,
          connectionConfigHash: digest,
          providerDataClassCeiling: "public-only",
          pricingId: "fixture",
          pricingVersion: 1,
          pricingFingerprint: "pr1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          pricingEffectiveAt: at,
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps reservations unique and rejects malformed known/unknown accounting", async () => {
    const f = await npRuntimePersistenceProviderFixture();
    await expect(
      f.db.insert(npAgentUsageReservations).values({ ...f.reservation, id: randomUUID() }),
    ).rejects.toThrow();
    for (const change of [
      { reservedCalls: 0 },
      { reservedInputTokens: -1 },
      { reservedCostMicros: Number.MAX_SAFE_INTEGER + 1 },
      { actualInputTokens: 1 },
      { actualUsageSource: "provider" },
      { unpriced: true },
      { state: "released", finalizedAt: at },
      {
        state: "expired",
        finalizedAt: later,
        actualUsageSource: "unknown",
        actualCostSource: "unknown",
        unpriced: true,
        budgetChargeCostMicros: 0,
      },
    ]) {
      await expect(
        f.db
          .update(npAgentUsageReservations)
          .set(change)
          .where(eq(npAgentUsageReservations.id, f.reservation.id!)),
      ).rejects.toThrow();
    }
    await f.db
      .update(npAgentUsageReservations)
      .set({
        state: "expired",
        finalizedAt: later,
        actualUsageSource: "unknown",
        actualCostSource: "unknown",
        unpriced: true,
        budgetChargeCostMicros: 100,
      })
      .where(eq(npAgentUsageReservations.id, f.reservation.id!));
  });

  it("requires complete source-attributed reconciliation", async () => {
    const f = await npRuntimePersistenceProviderFixture();
    const settled = {
      state: "reconciled",
      actualInputTokens: 50,
      actualCachedInputTokens: 10,
      actualOutputTokens: 20,
      actualCostMicros: 75,
      actualUsageSource: "provider",
      actualCostSource: "adapter-estimate",
      budgetChargeCostMicros: 75,
      finalizedAt: later,
    };
    await expect(
      f.db
        .update(npAgentUsageReservations)
        .set({ ...settled, actualCachedInputTokens: 51 })
        .where(eq(npAgentUsageReservations.id, f.reservation.id!)),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(npAgentUsageReservations)
        .set({ ...settled, actualCostSource: "unknown" })
        .where(eq(npAgentUsageReservations.id, f.reservation.id!)),
    ).rejects.toThrow();
    await f.db
      .update(npAgentUsageReservations)
      .set(settled)
      .where(eq(npAgentUsageReservations.id, f.reservation.id!));
  });

  it("separates provider and estimated daily accounting and keeps one bucket", async () => {
    const f = await npRuntimePersistenceProviderFixture();
    const row = {
      siteId: f.siteId,
      agentId: f.agentId,
      connectionId: f.connectionId,
      usageDate: "2026-09-01",
      providerCalls: 1,
    };
    await f.db.insert(npAgentUsageDaily).values(row);
    await expect(f.db.insert(npAgentUsageDaily).values(row)).rejects.toThrow();
    for (const change of [
      { reportedInputTokens: -1 },
      { estimatedCachedInputTokens: 1 },
      { unknownCalls: 2 },
      { reportedCostMicros: 1 },
      { budgetChargeCostMicros: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      await expect(
        f.db.update(npAgentUsageDaily).set(change).where(eq(npAgentUsageDaily.siteId, f.siteId)),
      ).rejects.toThrow();
    }
    await f.db
      .update(npAgentUsageDaily)
      .set({
        reportedInputTokens: 10,
        reportedCachedInputTokens: 2,
        estimatedOutputTokens: 20,
        estimatedCostMicros: 5,
        budgetChargeCostMicros: 5,
      })
      .where(eq(npAgentUsageDaily.siteId, f.siteId));
  });

  it("fences dispatch uncertainty without inventing usage or a parsed decision", async () => {
    const f = await npRuntimePersistenceProviderFixture();
    await f.db.insert(npAgentProviderCalls).values(f.call);
    const where = eq(npAgentProviderCalls.id, f.call.id!);
    for (const change of [
      { state: "in_flight", dispatchState: "not-dispatched", startedAt: at },
      { state: "succeeded", dispatchState: "dispatched", startedAt: at, finishedAt: later },
      {
        state: "ambiguous",
        dispatchState: "unknown",
        startedAt: at,
        finishedAt: later,
        responseDigest: digest,
        errorClass: "timeout",
        latencyMs: 1,
      },
      { inputTokens: 0 },
      {
        state: "failed",
        responseDigest: digest,
        latencyMs: 1,
        finishedAt: later,
        errorClass: null,
      },
    ]) {
      await expect(f.db.update(npAgentProviderCalls).set(change).where(where)).rejects.toThrow();
    }
    await f.db
      .update(npAgentProviderCalls)
      .set({ state: "in_flight", dispatchState: "unknown", startedAt: at })
      .where(where);
    await f.db
      .update(npAgentProviderCalls)
      .set({
        state: "ambiguous",
        responseDigest: digest,
        errorClass: "timeout",
        latencyMs: 1,
        usageSource: "unknown",
        costSource: "unknown",
        finishedAt: later,
      })
      .where(where);
    await expect(
      f.db.update(npAgentProviderCalls).set({ costMicros: 0, costCurrency: "USD" }).where(where),
    ).rejects.toThrow();
  });

  it("requires parsed successful decision and exact source/finish accounting", async () => {
    const f = await npRuntimePersistenceProviderFixture();
    const success: typeof npAgentProviderCalls.$inferInsert = {
      ...f.call,
      state: "succeeded",
      dispatchState: "dispatched",
      responseDigest: digest,
      decision: {
        task: "interactive-capability",
        decision: { kind: "complete", summary: "Checked" },
      },
      inputTokens: 20,
      cachedInputTokens: 5,
      outputTokens: 10,
      usageSource: "provider",
      costMicros: 5,
      costSource: "adapter-estimate",
      costCurrency: "USD",
      finishReason: "stop",
      latencyMs: 1,
      startedAt: at,
      finishedAt: later,
    };
    await expect(
      f.db.insert(npAgentProviderCalls).values({ ...success, decision: null }),
    ).rejects.toThrow();
    await expect(
      f.db.insert(npAgentProviderCalls).values({ ...success, cachedInputTokens: 21 }),
    ).rejects.toThrow();
    await expect(
      f.db.insert(npAgentProviderCalls).values({ ...success, finishReason: "content-filter" }),
    ).rejects.toThrow();
    await f.db.insert(npAgentProviderCalls).values(success);
  });

  it("ties provider reservations, secret metadata and run configuration to their same-site parents", async () => {
    const f = await npRuntimePersistenceProviderFixture(),
      other = await npCreateRuntimePersistenceFixture("runtime-b");
    const foreignConnection = await npRuntimePersistenceConnection(other);
    for (const change of [
      { secretVersionId: foreignConnection.secretId },
      { connectionConfigSnapshotId: foreignConnection.configId },
      { credentialVersion: 2 },
      { usageReservationId: randomUUID() },
      { requestDataClass: "sensitive-approved" },
    ]) {
      await expect(
        f.db.insert(npAgentProviderCalls).values({ ...f.call, ...change }),
      ).rejects.toThrow();
    }
  });

  it("keeps breaker scope private, exact state timestamps and CAS positive", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    const row = {
      siteId: f.siteId,
      scopeKind: "site",
      scopeRef: f.siteId,
      state: "closed",
      failureCount: 0,
      windowStartedAt: at,
      updatedAt: at,
    };
    await f.db.insert(npAgentCircuitBreakers).values(row);
    for (const change of [
      { scopeKind: "subject", scopeRef: "person@example.test" },
      { scopeRef: "runtime-b" },
      { state: "open" },
      { state: "half_open", openedAt: at, reasonCode: "PROVIDER_UNAVAILABLE" },
      { failureCount: -1 },
      { versionNumber: 0 },
    ]) {
      await expect(
        f.db.insert(npAgentCircuitBreakers).values({ ...row, ...change }),
      ).rejects.toThrow();
    }
    await f.db
      .update(npAgentCircuitBreakers)
      .set({
        state: "open",
        reasonCode: "PROVIDER_UNAVAILABLE",
        openedAt: at,
        retryAt: later,
        versionNumber: 2,
      })
      .where(eq(npAgentCircuitBreakers.siteId, f.siteId));
  });

  it("keeps event kind, deduplication and all-or-none immutable causation lookup", async () => {
    const f = await npCreateRuntimePersistenceFixture();
    const row: typeof npAgentEvents.$inferInsert = {
      siteId: f.siteId,
      kind: "agent.run.changed",
      sourceKind: "agent",
      sourceComponent: "runtime",
      deduplicationKey: "run:event",
      eventHash: digest,
      privacy: "internal",
      payload: {
        kind: "agent.run.changed",
        runId: randomUUID(),
        agentId: f.agentId,
        previousState: null,
        currentState: "queued",
        reasonCode: null,
      },
      occurredAt: at,
      recordedAt: at,
      expiresAt: later,
    };
    await f.db.insert(npAgentEvents).values(row);
    await expect(f.db.insert(npAgentEvents).values(row)).rejects.toThrow();
    for (const change of [
      { kind: "unregistered" },
      { sourceKind: "raw-http" },
      { sourceComponent: "/private?credential=value" },
      { causalRunId: randomUUID() },
      { causalDepth: 0 },
      { expiresAt: at },
    ]) {
      await expect(
        f.db.insert(npAgentEvents).values({ ...row, deduplicationKey: randomUUID(), ...change }),
      ).rejects.toThrow();
    }
    await f.db.insert(npAgentEvents).values({
      ...row,
      deduplicationKey: "retained:event",
      causation: {
        rootRunId: randomUUID(),
        sourceRunId: randomUUID(),
        sourceActionId: randomUUID(),
        depth: 0,
      },
    });
  });
});
