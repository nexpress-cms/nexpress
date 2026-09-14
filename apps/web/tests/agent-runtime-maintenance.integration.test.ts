import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import { npAgentEvents, npAgentRuns } from "../../../packages/core/src/db/schema/agent.js";
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
});
