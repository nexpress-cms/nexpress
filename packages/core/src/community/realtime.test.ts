import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  delete: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../db/runtime.js", () => ({
  getDb: () => db,
}));

import {
  NP_COMMUNITY_REALTIME_PRUNE_BATCH_SIZE,
  NP_COMMUNITY_REALTIME_RETENTION_MS,
  npGetCommunityRealtimeOutboxStats,
  npPruneCommunityRealtimeEvents,
} from "./realtime.js";

const EVENT_ID = "bd134b0f-b9ea-4ff4-81ef-606e42e27703";
const NEXT_EVENT_ID = "55ce542b-4c4e-4e7f-aa5b-0d1b70a44a91";

afterEach(() => {
  vi.clearAllMocks();
});

describe("community realtime retention", () => {
  it("returns exact persisted backlog statistics at the shared cutoff", async () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const oldestCreatedAt = new Date("2026-07-26T05:30:00.000Z");
    db.select.mockReturnValue({
      from: () =>
        Promise.resolve([
          {
            totalRows: "7",
            expiredRows: "2",
            oldestCreatedAt: oldestCreatedAt.toISOString(),
          },
        ]),
    });

    await expect(npGetCommunityRealtimeOutboxStats(now)).resolves.toEqual({
      totalRows: 7,
      expiredRows: 2,
      oldestCreatedAt,
      cutoff: new Date(now.getTime() - NP_COMMUNITY_REALTIME_RETENTION_MS),
    });
  });

  it("deletes no more than one validated oldest-first batch", async () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ id: EVENT_ID }, { id: NEXT_EVENT_ID }])
      .mockResolvedValueOnce([{ id: EVENT_ID }]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    db.select.mockReturnValue({
      from: () => ({ where }),
    });
    const returning = vi.fn().mockResolvedValue([{ id: EVENT_ID }]);
    db.delete.mockReturnValue({
      where: () => ({ returning }),
    });

    await expect(npPruneCommunityRealtimeEvents({ now, batchSize: 1 })).resolves.toEqual({
      deletedRows: 1,
      hasMore: true,
      cutoff: new Date(now.getTime() - NP_COMMUNITY_REALTIME_RETENTION_MS),
    });
    await expect(npPruneCommunityRealtimeEvents({ now, batchSize: 1 })).resolves.toEqual({
      deletedRows: 1,
      hasMore: false,
      cutoff: new Date(now.getTime() - NP_COMMUNITY_REALTIME_RETENTION_MS),
    });
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenNthCalledWith(1, 2);
    expect(limit).toHaveBeenNthCalledWith(2, 2);
    expect(orderBy).toHaveBeenCalledTimes(2);
    expect(returning).toHaveBeenCalledTimes(2);
  });

  it("rejects widened, invalid, and oversized prune requests before DB access", async () => {
    await expect(
      npPruneCommunityRealtimeEvents({ batchSize: NP_COMMUNITY_REALTIME_PRUNE_BATCH_SIZE + 1 }),
    ).rejects.toThrow("prune.batchSize");
    await expect(npPruneCommunityRealtimeEvents({ now: new Date("invalid") })).rejects.toThrow(
      "prune.now",
    );
    await expect(npPruneCommunityRealtimeEvents({ unexpected: true } as never)).rejects.toThrow(
      "Unsupported community realtime prune option",
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it("fails closed on internally inconsistent aggregate rows", async () => {
    db.select.mockReturnValue({
      from: () =>
        Promise.resolve([
          {
            totalRows: "1",
            expiredRows: "2",
            oldestCreatedAt: new Date("2026-07-26T05:30:00.000Z"),
          },
        ]),
    });

    await expect(npGetCommunityRealtimeOutboxStats()).rejects.toThrow(
      "expiredRows cannot exceed totalRows",
    );
  });
});
