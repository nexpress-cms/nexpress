import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import { npAgentEvents } from "../../../packages/core/src/db/schema/agent.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { npCollectAgentMaintenanceHealthV1 } from "../../../packages/core/src/agent/maintenance-evidence.js";
import { npPruneAgentRuntimeJobV1 } from "../../../packages/core/src/agent/runtime-maintenance-job.js";
import { collectAgentRuntimeMaintenanceV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import {
  NP_AGENT_MAINTENANCE_RECEIPT_KEY,
  npRequireAgentMaintenanceReceiptV1,
} from "../../../packages/core/src/agent-contract/maintenance-evidence-contract.js";
import {
  NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
  npCreateAgentRuntimeJobStateV1,
  npRequireAgentRuntimeJobStateV1,
} from "../../../packages/core/src/agent-contract/runtime-job-state-contract.js";

type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
const now = () => new Date("2026-09-21T00:00:00.000Z");
const id = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
function event(index: number) {
  const recordedAt = new Date("2026-09-20T00:00:00.000Z");
  return {
    id: id(index),
    siteId,
    kind: "jobs.handler.failed",
    sourceKind: "jobs",
    sourceComponent: "maintenance-evidence-test",
    eventHash: `cj1:sha256:${"A".repeat(43)}`,
    privacy: "internal",
    payload: {
      kind: "jobs.handler.failed" as const,
      handlerName: "agent:runExecute",
      jobId: id(1000 + index),
      reasonCode: "UNAVAILABLE",
    },
    occurredAt: recordedAt,
    recordedAt,
    dispatchedAt: recordedAt,
    expiresAt: new Date(recordedAt.getTime() + 60_000),
  };
}
async function setting(f: Fixture, key: string) {
  const [row] = await f.db
    .select({ value: npSettings.value })
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, key)));
  return row;
}
async function receipt(f: Fixture) {
  return npRequireAgentMaintenanceReceiptV1(
    (await setting(f, NP_AGENT_MAINTENANCE_RECEIPT_KEY))?.value,
  );
}

describe.skipIf(skipIfNoTestDb())("Agent retention execution receipts", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("does not create evidence on reads, but records an explicitly completed empty sweep", async () => {
    const f = await runtimeFixture();
    await collectAgentRuntimeMaintenanceV1({ siteId, now: now() });
    expect(
      (await npCollectAgentMaintenanceHealthV1({ runtime: false, now: now() })).receipts.state,
    ).toBe("never-recorded");
    expect(await setting(f, NP_AGENT_MAINTENANCE_RECEIPT_KEY)).toBeUndefined();
    expect(await setting(f, NP_AGENT_RUNTIME_JOBS_SETTING_KEY)).toBeUndefined();
    await npPruneAgentRuntimeJobV1({ siteId, now });
    expect(await receipt(f)).toMatchObject({
      lastBatch: { examined: 0, pruned: 0, completedAt: now().toISOString() },
      sweepStartedAt: null,
      expectedCursor: null,
      lastCompletedSweepAt: now().toISOString(),
    });
    expect(await setting(f, NP_AGENT_RUNTIME_JOBS_SETTING_KEY)).toBeUndefined();
    expect(
      (await npCollectAgentMaintenanceHealthV1({ runtime: false, now: now() })).receipts,
    ).toMatchObject({
      state: "observed",
      sampledSites: 1,
      completedSweepSites: 1,
      latestSweepAt: now().toISOString(),
    });
  });

  it("distinguishes a completed batch from the completed bounded sweep", async () => {
    const f = await runtimeFixture();
    await f.db.insert(npAgentEvents).values(Array.from({ length: 26 }, (_, i) => event(i + 1)));
    await npPruneAgentRuntimeJobV1({ siteId, now });
    expect(await receipt(f)).toMatchObject({
      lastBatch: { examined: 25, pruned: 25 },
      sweepStartedAt: now().toISOString(),
      expectedCursor: id(25),
      lastCompletedSweepAt: null,
    });
    await npPruneAgentRuntimeJobV1({ siteId, now });
    expect(await receipt(f)).toMatchObject({
      lastBatch: { examined: 1, pruned: 1 },
      sweepStartedAt: null,
      expectedCursor: null,
      lastCompletedSweepAt: now().toISOString(),
    });
  });

  it("serializes concurrent handlers so the final receipt follows the final cursor", async () => {
    const f = await runtimeFixture();
    await f.db.insert(npAgentEvents).values(Array.from({ length: 26 }, (_, i) => event(i + 1)));
    await Promise.all([
      npPruneAgentRuntimeJobV1({ siteId, now }),
      npPruneAgentRuntimeJobV1({ siteId, now }),
    ]);
    expect(await f.db.select({ id: npAgentEvents.id }).from(npAgentEvents)).toHaveLength(0);
    expect(await receipt(f)).toMatchObject({
      lastBatch: { examined: 1, pruned: 1 },
      expectedCursor: null,
      lastCompletedSweepAt: now().toISOString(),
    });
    expect(
      npRequireAgentRuntimeJobStateV1((await setting(f, NP_AGENT_RUNTIME_JOBS_SETTING_KEY))?.value)
        .cursors.retention,
    ).toBeNull();
  });

  it("rolls back pruning and cursor advancement when saving the receipt fails", async () => {
    const f = await runtimeFixture();
    await npPruneAgentRuntimeJobV1({ siteId, now });
    const previous = await receipt(f);
    await f.db.insert(npAgentEvents).values(Array.from({ length: 26 }, (_, i) => event(i + 1)));
    // Fail only the final receipt write; the previous row remains valid and readable.
    await f.db.execute(sql`alter table np_settings add constraint np_test_maintenance_receipt_write
      check (key <> 'agents.runtime.maintenance') not valid`);
    try {
      await expect(npPruneAgentRuntimeJobV1({ siteId, now })).rejects.toThrow();
      expect(await f.db.select({ id: npAgentEvents.id }).from(npAgentEvents)).toHaveLength(26);
      expect(await setting(f, NP_AGENT_RUNTIME_JOBS_SETTING_KEY)).toBeUndefined();
      expect(await receipt(f)).toEqual(previous);
    } finally {
      await f.db.execute(
        sql`alter table np_settings drop constraint np_test_maintenance_receipt_write`,
      );
    }
  });

  it("does not claim a full sweep after finishing an untracked legacy cursor tail", async () => {
    const f = await runtimeFixture();
    const state = npCreateAgentRuntimeJobStateV1();
    state.cursors.retention = id(25);
    await f.db
      .insert(npSettings)
      .values({ siteId, key: NP_AGENT_RUNTIME_JOBS_SETTING_KEY, value: state });
    await f.db.insert(npAgentEvents).values([event(1), event(26)]);
    await npPruneAgentRuntimeJobV1({ siteId, now });
    expect(await receipt(f)).toMatchObject({
      lastBatch: { examined: 1, pruned: 1 },
      lastCompletedSweepAt: null,
    });
    expect(await f.db.select({ id: npAgentEvents.id }).from(npAgentEvents)).toEqual([
      { id: id(1) },
    ]);
    await npPruneAgentRuntimeJobV1({ siteId, now });
    expect(await receipt(f)).toMatchObject({ lastCompletedSweepAt: now().toISOString() });
  });

  it("leaves candidates and durable cursors untouched when prior receipt is malformed", async () => {
    const f = await runtimeFixture();
    await f.db.insert(npAgentEvents).values(event(1));
    await f.db.insert(npSettings).values({
      siteId,
      key: NP_AGENT_MAINTENANCE_RECEIPT_KEY,
      value: { credential: "private-corrupt-evidence" },
    });
    await expect(npPruneAgentRuntimeJobV1({ siteId, now })).rejects.toThrow();
    expect(await f.db.select({ id: npAgentEvents.id }).from(npAgentEvents)).toEqual([
      { id: id(1) },
    ]);
    expect(await setting(f, NP_AGENT_RUNTIME_JOBS_SETTING_KEY)).toBeUndefined();
  });
});
