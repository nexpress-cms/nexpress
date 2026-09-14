import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import { createAgentRuntimeJobsV1 } from "../../../packages/core/src/agent/runtime-jobs.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { setJobQueue } from "../../../packages/core/src/jobs/queue.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import {
  NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
  npCreateAgentRuntimeJobStateV1,
  npRequireAgentRuntimeJobStateV1,
} from "../../../packages/core/src/agent-contract/runtime-job-state-contract.js";

async function fixture() {
  const f = await runtimeFixture();
  const events = createAgentRuntimeEventServiceV1({
    admission: f.admission,
    deploymentAuthority: f.options.deploymentAuthority,
    now: f.options.now,
  });
  const execute = vi.fn(async () => ({ state: "queued" }));
  const jobs = createAgentRuntimeJobsV1({
    coordinationSiteId: siteId,
    events,
    executor: { process: execute },
    now: f.options.now,
  });
  const enqueue = vi.fn(async () => randomUUID());
  setJobQueue({
    enqueue,
    start: async () => {},
    stop: async () => {},
    countSiteEnqueues: async () => 0,
  });
  return { ...f, events, jobs, execute, enqueue };
}
describe.skipIf(skipIfNoTestDb())("Runtime durable job recovery", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(async () => {
    setJobQueue(null);
    await closeTestDb();
  });
  it("recovers an admitted Run after lost enqueue without executing provider work in the global scan", async () => {
    const f = await fixture();
    const run = await f.admission.admit(f.runInput);
    await f.jobs.reconcile();
    expect(f.enqueue).toHaveBeenCalledWith("agent:runExecute", { siteId, runId: run.runId });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("retains a failed enqueue source and retries on the next fair cursor wrap", async () => {
    const f = await fixture();
    const run = await f.admission.admit(f.runInput);
    f.enqueue.mockRejectedValueOnce(new Error("private queue body"));
    await expect(f.jobs.reconcile()).rejects.toThrow("Agent runtime job is unavailable.");
    await f.jobs.reconcile();
    expect(f.enqueue).toHaveBeenLastCalledWith("agent:runExecute", { siteId, runId: run.runId });
    expect(f.enqueue).toHaveBeenCalledTimes(2);
  });
  it("persists an empty end-page reset so earlier Run ids cannot starve", async () => {
    const f = await fixture();
    const run = await f.admission.admit(f.runInput);
    const value = npCreateAgentRuntimeJobStateV1();
    value.cursors.runs = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await f.db.insert(npSettings).values({ siteId, key: NP_AGENT_RUNTIME_JOBS_SETTING_KEY, value });
    await f.jobs.reconcile();
    expect(f.enqueue).not.toHaveBeenCalled();
    const [row] = await f.db
      .select()
      .from(npSettings)
      .where(
        and(eq(npSettings.siteId, siteId), eq(npSettings.key, NP_AGENT_RUNTIME_JOBS_SETTING_KEY)),
      );
    expect(npRequireAgentRuntimeJobStateV1(row?.value).cursors.runs).toBeNull();
    await f.jobs.reconcile();
    expect(f.enqueue).toHaveBeenCalledWith("agent:runExecute", { siteId, runId: run.runId });
  });
  it("fails closed on corrupted private scan state without forwarding it to queue or provider", async () => {
    const f = await fixture();
    await f.db.insert(npSettings).values({
      siteId,
      key: NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
      value: { credential: "private-metadata" },
    });
    await expect(f.jobs.reconcile()).rejects.toThrow("Agent runtime job is unavailable.");
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
});
