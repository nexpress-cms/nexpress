import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { enqueueJob, setJobQueue } from "../../../packages/core/src/jobs/queue.js";
import { getJobHandler } from "../../../packages/core/src/jobs/handlers.js";

async function fixture() {
  const f = await runtimeFixture();
  expect(getJobHandler("agent:runExecute")).toBeUndefined();
  await f.db.insert(npSettings).values({
    siteId,
    key: "site.quotas",
    value: { storageBytes: null, documents: null, jobEnqueuesPerHour: 1 },
  });
  const countSiteEnqueues = vi.fn(async (site: string) => {
    const result = await f.db.execute(
      sql`select count(distinct target_id)::int as count from np_audit_events where site_id=${site} and action='agent.runtime.job_admitted' and actor_kind='system' and target_type='agent-run' and created_at>=now()-interval '1 hour'`,
    );
    return Number(result.rows[0]!.count);
  });
  const enqueue = vi.fn().mockResolvedValue(randomUUID());
  setJobQueue({
    enqueue,
    countSiteEnqueues,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  });
  const { runId } = await f.admission.admit(f.runInput);
  return { ...f, runId, enqueue, countSiteEnqueues };
}
describe.skipIf(skipIfNoTestDb())("Runtime initial job quota receipt", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterEach(() => setJobQueue(null));
  afterAll(closeTestDb);

  it("reserves one charge before failed delivery and allows repeated recovery at exhausted quota", async () => {
    const f = await fixture();
    f.enqueue.mockRejectedValueOnce(new Error("delivery unavailable"));
    await expect(enqueueJob("agent:runExecute", { siteId, runId: f.runId })).rejects.toThrow(
      "delivery unavailable",
    );
    await enqueueJob("agent:runExecute", { siteId, runId: f.runId });
    await enqueueJob("agent:runExecute", { siteId, runId: f.runId });
    const receipts = await f.db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.siteId, siteId),
          eq(npAuditEvents.action, "agent.runtime.job_admitted"),
        ),
      );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.payload).toEqual({});
    expect(f.countSiteEnqueues).toHaveBeenCalledTimes(1);
    expect(f.enqueue).toHaveBeenCalledTimes(3);
    const second = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
    await expect(
      enqueueJob("agent:runExecute", { siteId, runId: second.runId }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("serializes duplicate admission and never accepts a foreign or nonexistent Run", async () => {
    const f = await fixture();
    await Promise.all([
      enqueueJob("agent:runExecute", { siteId, runId: f.runId }),
      enqueueJob("agent:runExecute", { siteId, runId: f.runId }),
    ]);
    expect(f.countSiteEnqueues).toHaveBeenCalledOnce();
    await expect(
      enqueueJob("agent:runExecute", { siteId: "other", runId: f.runId }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(
      enqueueJob("agent:runExecute", { siteId, runId: randomUUID() }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(f.enqueue).toHaveBeenCalledTimes(2);
  });
});
