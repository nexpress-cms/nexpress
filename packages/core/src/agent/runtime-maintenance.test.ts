import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn() }));
vi.mock("./runtime-controls.js", () => ({
  npWithAgentRuntimeControlTransactionV1: mocks.transaction,
}));
import {
  collectAgentRuntimeMaintenanceV1,
  pruneAgentRuntimeEventsV1,
} from "./runtime-maintenance.js";

describe("Runtime maintenance boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation((_site, callback) =>
      callback({
        db: { execute: mocks.execute },
        settings: { enabled: false, emergencyPause: { paused: false } },
      }),
    );
  });
  it("rejects malformed bounds and foreign fields before opening a transaction", async () => {
    for (const value of [
      { siteId: "_system" },
      { siteId: "tenant", limit: 0 },
      { siteId: "tenant", limit: 101 },
      { siteId: "tenant", limit: 1.5 },
      { siteId: "tenant", cursor: "arbitrary" },
      { siteId: "tenant", now: new Date(NaN) },
      { siteId: "tenant", credential: "private" },
    ])
      await expect(pruneAgentRuntimeEventsV1(value)).rejects.toMatchObject({
        code: "RUNTIME_MAINTENANCE_INVALID",
      });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("projects only exact aggregate facts and nullable ages", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            total: "3",
            pending: "2",
            expired: "1",
            expired_pending: "1",
            oldest: "2026-09-14T00:00:00Z",
            payload: "private",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "1", enabled: "1", due: "0", oldest: null }] })
      .mockResolvedValueOnce({
        rows: [{ total: "0", active: "0", queued: "0", waiting_approval: "0", oldest: null }],
      });
    const result = await collectAgentRuntimeMaintenanceV1({
      siteId: "tenant",
      now: new Date("2026-09-14T00:01:00Z"),
    });
    expect(result).toEqual({
      runtime: {
        enabled: false,
        paused: false,
        total: 0,
        active: 0,
        queued: 0,
        waitingApproval: 0,
        oldestQueuedAgeSeconds: null,
      },
      events: { total: 3, pending: 2, expired: 1, expiredPending: 1, oldestPendingAgeSeconds: 60 },
      triggers: { total: 1, enabled: 1, due: 0, oldestDueAgeSeconds: null },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("fails closed on invalid aggregate counts and timestamps", async () => {
    for (const invalid of [
      { total: "9007199254740992" },
      { oldest: "invalid" },
      { oldest: "2027-01-01" },
    ]) {
      mocks.execute
        .mockResolvedValueOnce({
          rows: [
            {
              total: "0",
              pending: "0",
              expired: "0",
              expired_pending: "0",
              oldest: null,
              ...invalid,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: "0", enabled: "0", due: "0", oldest: null }] })
        .mockResolvedValueOnce({
          rows: [{ total: "0", active: "0", queued: "0", waiting_approval: "0", oldest: null }],
        });
      await expect(
        collectAgentRuntimeMaintenanceV1({
          siteId: "tenant",
          now: new Date("2026-09-14T00:01:00Z"),
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_MAINTENANCE_INVALID" });
    }
  });
});
