import { beforeEach, describe, expect, it, vi } from "vitest";

const pgRuntime = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
  query: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Client: class {
      connect = pgRuntime.connect;
      end = pgRuntime.end;
      query = pgRuntime.query;
    },
  },
}));

import { checkCommunityRealtimeRetention } from "./community-realtime-check.js";

beforeEach(() => {
  pgRuntime.connect.mockReset().mockResolvedValue(undefined);
  pgRuntime.end.mockReset().mockResolvedValue(undefined);
  pgRuntime.query.mockReset();
});

describe("community realtime retention operations check", () => {
  it("combines exact outbox statistics with recent cleanup failures before closing", async () => {
    pgRuntime.query
      .mockResolvedValueOnce({
        rows: [
          {
            tableName: "np_community_realtime_events",
            liveJobs: "pgboss.job",
            archivedJobs: "pgboss.archive",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            totalRows: "4",
            expiredRows: "1",
            oldestCreatedAt: new Date("2026-07-26T05:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: [{ total: "2" }] });

    await expect(
      checkCommunityRealtimeRetention({
        DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/nexpress_test",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "community.realtime_retention",
        state: "warn",
        detail: expect.stringMatching(/1 expired of 4.*3 cleanup failures in 24h/u),
      }),
    );
    expect(pgRuntime.query).toHaveBeenCalledTimes(4);
    expect(pgRuntime.end).toHaveBeenCalledOnce();
  });

  it("fails closed and releases the client when persisted counts are malformed", async () => {
    pgRuntime.query
      .mockResolvedValueOnce({
        rows: [
          {
            tableName: "np_community_realtime_events",
            liveJobs: null,
            archivedJobs: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ totalRows: "-1", expiredRows: "0", oldestCreatedAt: null }],
      });

    await expect(
      checkCommunityRealtimeRetention({
        DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/nexpress_test",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "warn",
        detail: expect.stringContaining("must be a non-negative integer string"),
      }),
    );
    expect(pgRuntime.end).toHaveBeenCalledOnce();
  });
});
