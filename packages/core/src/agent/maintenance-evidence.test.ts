import { beforeEach, describe, expect, it, vi } from "vitest";
import { npCollectAgentMaintenanceHealthV1 } from "./maintenance-evidence.js";
import { npNextAgentMaintenanceReceiptV1 } from "../agent-contract/maintenance-evidence-contract.js";
const mocks = vi.hoisted(() => ({ handler: vi.fn(), queue: vi.fn(), workers: vi.fn() }));
vi.mock("../jobs/handlers.js", () => ({ getJobHandler: mocks.handler }));
vi.mock("../jobs/queue.js", () => ({ getOptionalJobQueue: mocks.queue }));
vi.mock("../jobs/heartbeat.js", () => ({ listWorkerHealth: mocks.workers }));
const now = new Date("2026-09-21T00:00:00.000Z");
const receipt = npNextAgentMaintenanceReceiptV1(null, {
  startedAt: now.toISOString(),
  completedAt: now.toISOString(),
  examined: 0,
  pruned: 0,
  cursor: null,
  nextCursor: null,
});
const query = vi.fn();
const collect = (runtime = false) =>
  npCollectAgentMaintenanceHealthV1({ client: { query }, now, runtime });
beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue({ rows: [] });
  mocks.workers.mockResolvedValue({ aliveCount: 0, totalCount: 0, newestHeartbeat: null });
});
describe("maintenance evidence projection", () => {
  it("reads bounded receipts without exposing private traversal metadata or initializing runtime", async () => {
    query.mockResolvedValue({ rows: Array.from({ length: 101 }, () => ({ value: receipt })) });
    const result = await collect();
    expect(result.receipts).toMatchObject({
      state: "observed",
      sampledSites: 100,
      hasMore: true,
      completedSweepSites: 100,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("limit 101"), [
      "agents.runtime.maintenance",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/expectedCursor|sweepStartedAt|siteId/);
    expect(result.queue.state).toBe("unavailable");
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.workers).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("distinguishes absence from unreadable, malformed and future evidence", async () => {
    expect((await collect()).receipts.state).toBe("never-recorded");
    for (const value of [
      {},
      { ...receipt, privateToken: "secret" },
      {
        ...receipt,
        lastBatch: { ...receipt.lastBatch, completedAt: "2026-09-22T00:00:00.000Z" },
      },
    ]) {
      query.mockResolvedValue({ rows: [{ value }] });
      expect((await collect()).receipts).toMatchObject({
        state: "unavailable",
        sampledSites: null,
        latestBatch: null,
      });
    }
    query.mockRejectedValue(new Error("secret database details"));
    expect(JSON.stringify(await collect())).not.toContain("secret");
    expect((await collect()).receipts.state).toBe("unavailable");
  });
  it("reports only generic worker counts and host queue history under explicit runtime collection", async () => {
    mocks.handler.mockReturnValue({ name: "agent:retentionPrune" });
    mocks.workers.mockResolvedValue({
      aliveCount: 1,
      totalCount: 2,
      newestHeartbeat: now.toISOString(),
      workers: [{ id: "private-hostname" }],
    });
    const listJobs = vi.fn().mockResolvedValue({ jobs: [], total: 3 });
    mocks.queue.mockReturnValue({ listJobs });
    const result = await collect(true);
    expect(result.registration).toBe("registered");
    expect(result.workers).toEqual({
      state: "observed",
      aliveCount: 1,
      totalCount: 2,
      newestHeartbeat: now.toISOString(),
    });
    expect(result.queue).toEqual({ state: "supported", retainedFailures: 9 });
    expect(listJobs.mock.calls.map(([filter]) => filter)).toEqual(
      ["failed", "retry", "expired"].map((state) => ({
        name: "agent:retentionPrune",
        state,
        limit: 1,
      })),
    );
    expect(JSON.stringify(result)).not.toContain("private-hostname");
  });
  it("preserves unknown failure states without manufacturing zero workers or failures", async () => {
    expect((await collect(true)).queue.state).toBe("unsupported");
    mocks.workers.mockRejectedValue(new Error("private"));
    mocks.queue.mockReturnValue({ listJobs: vi.fn().mockRejectedValue(new Error("private")) });
    const result = await collect(true);
    expect(result.workers).toMatchObject({ state: "unavailable", aliveCount: null });
    expect(result.queue).toEqual({ state: "unavailable", retainedFailures: null });
    mocks.workers.mockResolvedValue({
      aliveCount: 2,
      totalCount: 1,
      newestHeartbeat: now.toISOString(),
    });
    mocks.queue.mockReturnValue({ listJobs: vi.fn().mockResolvedValue({ jobs: [], total: -1 }) });
    expect((await collect(true)).workers.state).toBe("unavailable");
    expect((await collect(true)).queue.state).toBe("unavailable");
  });
});
