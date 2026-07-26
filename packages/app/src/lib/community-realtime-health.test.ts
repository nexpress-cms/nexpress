import { describe, expect, it } from "vitest";

import { evaluateCommunityRealtimeHealth } from "./community-realtime-health.js";

describe("community realtime health projection", () => {
  it("reports an empty or entirely retained outbox as healthy", () => {
    expect(
      evaluateCommunityRealtimeHealth({
        totalRows: 0,
        expiredRows: 0,
        oldestCreatedAt: null,
        cutoff: new Date("2026-07-26T06:00:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        id: "community.realtime_retention",
        state: "ok",
        detail: "empty · 6-hour retention",
      }),
    );
  });

  it("surfaces exact expired count, oldest row, and cleanup guidance", () => {
    expect(
      evaluateCommunityRealtimeHealth({
        totalRows: 12,
        expiredRows: 3,
        oldestCreatedAt: new Date("2026-07-26T05:00:00.000Z"),
        cutoff: new Date("2026-07-26T06:00:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        state: "warn",
        detail: "3 expired of 12 row(s) · oldest 2026-07-26T05:00:00.000Z",
        hint: expect.stringContaining("system:communityRealtimePrune"),
      }),
    );
  });

  it("warns on a recent cleanup failure before rows expire", () => {
    expect(
      evaluateCommunityRealtimeHealth(
        {
          totalRows: 2,
          expiredRows: 0,
          oldestCreatedAt: new Date("2026-07-26T07:00:00.000Z"),
          cutoff: new Date("2026-07-26T06:00:00.000Z"),
        },
        1,
      ),
    ).toEqual(
      expect.objectContaining({
        state: "warn",
        detail: expect.stringContaining("1 cleanup failure in 24h"),
      }),
    );
  });

  it("fails closed on inconsistent observations", () => {
    expect(() =>
      evaluateCommunityRealtimeHealth({
        totalRows: 1,
        expiredRows: 2,
        oldestCreatedAt: new Date("2026-07-26T05:00:00.000Z"),
        cutoff: new Date("2026-07-26T06:00:00.000Z"),
      }),
    ).toThrow("expiredRows cannot exceed totalRows");
  });
});
