import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { npWithAgentRuntimeRetentionBudgetV1 } from "../../../packages/core/src/agent/runtime-retention-budget.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import {
  npAgentEvents,
  npAgentRuns,
  npAgentCircuitBreakers,
  npAgentVersions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSites } from "../../../packages/core/src/db/schema/system.js";
import {
  collectAgentRuntimeMaintenanceV1,
  pruneAgentRuntimeEventsV1,
} from "../../../packages/core/src/agent/runtime-maintenance.js";

function event(site: string, options: { id?: string; pending?: boolean; fresh?: boolean } = {}) {
  const recordedAt = new Date(Date.now() - 60_000);
  return {
    id: options.id ?? randomUUID(),
    siteId: site,
    kind: "jobs.handler.failed",
    sourceKind: "jobs",
    sourceComponent: "maintenance-test",
    eventHash: `cj1:sha256:${"A".repeat(43)}`,
    privacy: "internal",
    payload: {
      kind: "jobs.handler.failed" as const,
      handlerName: "agent:runExecute",
      jobId: randomUUID(),
      reasonCode: "UNAVAILABLE",
    },
    occurredAt: recordedAt,
    recordedAt,
    dispatchedAt: options.pending ? null : recordedAt,
    expiresAt: new Date(Date.now() + (options.fresh ? 60_000 : -30_000)),
  };
}
describe.skipIf(skipIfNoTestDb())("Runtime event maintenance", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("prunes only expired dispatched rows in the exact site and retains pending/fresh events", async () => {
    const f = await runtimeFixture();
    await f.db.insert(npSites).values({ id: "maintenance-other", name: "Other" });
    const expired = event(siteId),
      pending = event(siteId, { pending: true }),
      fresh = event(siteId, { fresh: true }),
      other = event("maintenance-other");
    await f.db.insert(npAgentEvents).values([expired, pending, fresh, other]);
    expect(await pruneAgentRuntimeEventsV1({ siteId })).toEqual({
      examined: 1,
      pruned: 1,
      nextCursor: null,
    });
    const remaining = await f.db.select({ id: npAgentEvents.id }).from(npAgentEvents);
    expect(remaining.map((row) => row.id).sort()).toEqual([pending.id, fresh.id, other.id].sort());
    const summary = await collectAgentRuntimeMaintenanceV1({ siteId });
    expect(summary.events).toMatchObject({ total: 2, pending: 1, expired: 1, expiredPending: 1 });
    expect(JSON.stringify(summary)).not.toContain(siteId);
  });

  it("retains causal and nested event evidence required by an active run", async () => {
    const f = await runtimeFixture();
    const { runId } = await f.admission.admit(f.runInput);
    const causal = event(siteId),
      nested = event(siteId),
      unused = event(siteId);
    await f.db.insert(npAgentEvents).values([causal, nested, unused]);
    await f.db
      .update(npAgentRuns)
      .set({ causalEventId: causal.id, eventRef: { evidence: [{ eventId: nested.id }] } })
      .where(eq(npAgentRuns.id, runId));
    const result = await pruneAgentRuntimeEventsV1({ siteId });
    expect(result).toEqual({ examined: 3, pruned: 1, nextCursor: null });
    const remaining = await f.db.select({ id: npAgentEvents.id }).from(npAgentEvents);
    expect(remaining.map((row) => row.id).sort()).toEqual([causal.id, nested.id].sort());
    expect((await collectAgentRuntimeMaintenanceV1({ siteId })).runtime).toMatchObject({
      active: 1,
      queued: 1,
    });
  });

  it("advances bounded cursors and rejects a missing site without modifying other events", async () => {
    const f = await runtimeFixture();
    await f.db.insert(npAgentEvents).values([event(siteId), event(siteId), event(siteId)]);
    const first = await pruneAgentRuntimeEventsV1({ siteId, limit: 2 });
    expect(first).toMatchObject({ examined: 2, pruned: 2 });
    expect(first.nextCursor).not.toBeNull();
    expect(await pruneAgentRuntimeEventsV1({ siteId, limit: 2, cursor: first.nextCursor })).toEqual(
      { examined: 1, pruned: 1, nextCursor: null },
    );
    await expect(pruneAgentRuntimeEventsV1({ siteId: "missing" })).rejects.toMatchObject({
      code: "RUNTIME_SITE_UNAVAILABLE",
    });
  });
  it("retains nested audit references and advances past protected identities", async () => {
    const f = await runtimeFixture();
    const protectedEvent = event(siteId, { id: "00000000-0000-4000-8000-000000000001" });
    const removable = event(siteId, { id: "00000000-0000-4000-8000-000000000002" });
    await f.db.insert(npAgentEvents).values([protectedEvent, removable]);
    await f.db.insert(npAuditEvents).values({
      siteId,
      actorKind: "system",
      action: "test.required-evidence",
      payload: { evidence: [{ sourceId: protectedEvent.id }] },
    });
    const first = await pruneAgentRuntimeEventsV1({ siteId, limit: 1 });
    expect(first).toEqual({ examined: 1, pruned: 0, nextCursor: protectedEvent.id });
    const second = await pruneAgentRuntimeEventsV1({ siteId, limit: 1, cursor: first.nextCursor });
    expect(second).toEqual({ examined: 1, pruned: 1, nextCursor: removable.id });
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "test.required-evidence")),
    ).toHaveLength(1);
  });

  it("retains audited terminal Runs and prunes only after their last reference is gone", async () => {
    const f = await runtimeFixture();
    const { runId } = await f.admission.admit(f.runInput);
    const finishedAt = f.options.now();
    await f.db
      .update(npAgentRuns)
      .set({ state: "cancelled", finishedAt })
      .where(eq(npAgentRuns.id, runId));
    const now = new Date(finishedAt.getTime() + 90 * 86_400_000);
    expect(await pruneAgentRuntimeEventsV1({ siteId, now })).toEqual({
      examined: 1,
      pruned: 0,
      nextCursor: null,
    });
    // Simulate the owning audit lifecycle having released its evidence.
    await f.db
      .delete(npAuditEvents)
      .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.targetId, runId)));
    expect(await pruneAgentRuntimeEventsV1({ siteId, now: new Date(now.getTime() - 1) })).toEqual({
      examined: 1,
      pruned: 0,
      nextCursor: null,
    });
    expect(await pruneAgentRuntimeEventsV1({ siteId, now })).toEqual({
      examined: 1,
      pruned: 1,
      nextCursor: null,
    });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });

  it("traverses same-UUID categories together and preserves unhealthy breakers", async () => {
    const f = await runtimeFixture();
    const old = new Date(f.options.now().getTime() - 91 * 86_400_000);
    const shared = event(siteId);
    await f.db.insert(npAgentEvents).values(shared);
    await f.db.insert(npAgentCircuitBreakers).values([
      {
        id: shared.id,
        siteId,
        scopeKind: "site",
        scopeRef: siteId,
        state: "closed",
        failureCount: 0,
        windowStartedAt: old,
        updatedAt: old,
      },
      {
        siteId,
        scopeKind: "subject",
        scopeRef: "A".repeat(43),
        state: "closed",
        failureCount: 1,
        windowStartedAt: old,
        updatedAt: old,
      },
      {
        siteId,
        scopeKind: "subject",
        scopeRef: "B".repeat(43),
        state: "open",
        failureCount: 1,
        reasonCode: "PROVIDER_FAILURE",
        windowStartedAt: old,
        openedAt: old,
        retryAt: f.options.now(),
        updatedAt: old,
      },
    ]);
    // Equal identities in unrelated tables are conservatively references to
    // each other. Both categories are examined, but neither loses evidence.
    const result = await pruneAgentRuntimeEventsV1({ siteId, limit: 1, now: new Date() });
    expect(result).toEqual({ examined: 1, pruned: 0, nextCursor: shared.id });
    await f.db.delete(npAgentEvents).where(eq(npAgentEvents.id, shared.id));
    expect(await pruneAgentRuntimeEventsV1({ siteId, now: new Date() })).toMatchObject({
      examined: 1,
      pruned: 1,
    });
    expect(await f.db.select().from(npAgentCircuitBreakers)).toHaveLength(2);
  });
  it("uses current policy retention and retains malformed canonical evidence", async () => {
    const f = await runtimeFixture();
    const { runId } = await f.admission.admit(f.runInput);
    const finishedAt = f.options.now();
    await f.db
      .update(npAgentRuns)
      .set({ state: "cancelled", finishedAt })
      .where(eq(npAgentRuns.id, runId));
    await f.db
      .delete(npAuditEvents)
      .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.targetId, runId)));
    await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, settings, revision }) => {
      settings.defaultPolicyRules.retentionDays.runDetails = 1;
      return f.controls.updateInTransaction({
        db,
        siteId,
        expectedRevision: revision,
        actorFingerprint: f.options.deploymentAuthority.fingerprint,
        settings,
      });
    });
    const [valid] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, runId));
    if (!valid) throw new Error("Run fixture missing");
    await f.db
      .update(npAgentRuns)
      .set({ admissionFingerprint: "cj1:sha256:" + "B".repeat(43) })
      .where(eq(npAgentRuns.id, runId));
    const now = new Date(finishedAt.getTime() + 86_400_000);
    expect(await pruneAgentRuntimeEventsV1({ siteId, now })).toEqual({
      examined: 1,
      pruned: 0,
      nextCursor: null,
    });
    await f.db
      .update(npAgentRuns)
      .set({ admissionFingerprint: valid.admissionFingerprint })
      .where(eq(npAgentRuns.id, runId));
    const [version] = await f.db
      .select()
      .from(npAgentVersions)
      .where(eq(npAgentVersions.id, valid.agentVersionId!));
    if (!version) throw new Error("Version fixture missing");
    await f.db.execute(
      sql`update np_agent_versions set recipe_registry_body=jsonb_set(recipe_registry_body,'{recipes,0,version}','0'::jsonb) where id=${version.id}::uuid`,
    );
    expect(await pruneAgentRuntimeEventsV1({ siteId, now })).toEqual({
      examined: 1,
      pruned: 0,
      nextCursor: null,
    });
    await f.db
      .update(npAgentVersions)
      .set({ recipeRegistryBody: version.recipeRegistryBody })
      .where(eq(npAgentVersions.id, version.id));
    expect(await pruneAgentRuntimeEventsV1({ siteId, now })).toEqual({
      examined: 1,
      pruned: 1,
      nextCursor: null,
    });
  });

  it.each(["first pass", "reused journal"])(
    "retains live durable job sources after dispatch expiry (%s)",
    async () => {
      const f = await runtimeFixture();
      const source = event(siteId);
      await f.db.insert(npAgentEvents).values(source);
      const url = getTestDatabaseUrl();
      if (!url) throw new Error("TEST_DATABASE_URL not set");
      const adapter = new PgBossAdapter(url);
      const id = randomUUID();
      // Worker databases are reused across test files, so the real journal may
      // already exist. Producer initialization is idempotent and starts no job
      // processing. Store one synthetic fact and preserve the shared schema.
      try {
        await adapter.startProducer();
        await f.db.execute(
          sql`insert into pgboss.job (id,name,state,data) values (${id}::uuid,'search.reindex','active',${JSON.stringify({ siteId, eventId: source.id })}::jsonb)`,
        );
        expect(await pruneAgentRuntimeEventsV1({ siteId })).toEqual({
          examined: 1,
          pruned: 0,
          nextCursor: null,
        });
        await f.db.execute(sql`update pgboss.job set state='completed' where id=${id}::uuid`);
        expect(await pruneAgentRuntimeEventsV1({ siteId })).toEqual({
          examined: 1,
          pruned: 1,
          nextCursor: null,
        });
      } finally {
        await adapter.stop();
        await f.db.execute(sql`delete from pgboss.job where id=${id}::uuid`);
      }
    },
  );
  it("cancels lock contention within the maintenance statement budget and rolls back prior pruning", async () => {
    const f = await runtimeFixture();
    const source = event(siteId);
    await f.db.insert(npAgentEvents).values(source);
    let release!: () => void;
    let ready!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const blocker = f.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(508, 507)`);
      ready();
      await released;
    });
    await locked;
    try {
      await expect(
        npWithAgentRuntimeRetentionBudgetV1(async (db) => {
          await db.delete(npAgentEvents).where(eq(npAgentEvents.id, source.id));
          await db.execute(sql`select pg_advisory_xact_lock(508, 507)`);
        }),
      ).rejects.toMatchObject({ cause: { code: "57014" } });
    } finally {
      release();
      await blocker;
    }
    expect(
      await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.id, source.id)),
    ).toHaveLength(1);
    expect((await pruneAgentRuntimeEventsV1({ siteId })).pruned).toBe(1);
  });
});
