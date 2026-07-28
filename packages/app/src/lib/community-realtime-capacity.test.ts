import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NP_COMMUNITY_REALTIME_DEFAULT_MAX_SITE_STREAMS,
  NP_COMMUNITY_REALTIME_DEFAULT_MAX_STREAMS,
  NP_COMMUNITY_REALTIME_RETRY_AFTER_SECONDS,
  npAcquireCommunityRealtimeStream,
  npCheckCommunityRealtimeCapacityConfig,
  npGetCommunityRealtimeCapacitySnapshot,
  npReadCommunityRealtimeCapacityConfig,
  npResetCommunityRealtimeCapacityForTests,
} from "./community-realtime-capacity.js";

afterEach(() => {
  vi.unstubAllEnvs();
  npResetCommunityRealtimeCapacityForTests();
});

describe("community realtime capacity", () => {
  it("reads bounded defaults and rejects non-canonical settings", () => {
    expect(npReadCommunityRealtimeCapacityConfig({})).toEqual({
      maxStreams: NP_COMMUNITY_REALTIME_DEFAULT_MAX_STREAMS,
      maxSiteStreams: NP_COMMUNITY_REALTIME_DEFAULT_MAX_SITE_STREAMS,
    });
    expect(() =>
      npReadCommunityRealtimeCapacityConfig({
        NP_COMMUNITY_REALTIME_MAX_STREAMS: "02",
      }),
    ).toThrow("canonical positive integer");
    expect(() =>
      npReadCommunityRealtimeCapacityConfig({
        NP_COMMUNITY_REALTIME_MAX_STREAMS: "2",
        NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS: "3",
      }),
    ).toThrow("must be less than or equal");
    expect(() =>
      npReadCommunityRealtimeCapacityConfig({
        NP_COMMUNITY_REALTIME_MAX_STREAMS: "10001",
      }),
    ).toThrow("between 1 and 10000");
  });

  it("projects one exact Doctor and ops setting check", () => {
    expect(
      npCheckCommunityRealtimeCapacityConfig({
        NP_COMMUNITY_REALTIME_MAX_STREAMS: "12",
        NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS: "3",
      }),
    ).toEqual({
      id: "community.realtime_capacity",
      state: "ok",
      label: "Community realtime capacity",
      detail: "12 process stream(s) · 3 per site",
    });
    expect(
      npCheckCommunityRealtimeCapacityConfig({
        NP_COMMUNITY_REALTIME_MAX_STREAMS: "0",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "community.realtime_capacity",
        state: "error",
        hint: expect.stringContaining("per-site limit"),
      }),
    );
  });

  it("enforces the per-site limit without consuming another site's slot", () => {
    const env = {
      NP_COMMUNITY_REALTIME_MAX_STREAMS: "3",
      NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS: "1",
    };
    const first = npAcquireCommunityRealtimeStream("default", env);
    if (!first.accepted) throw new Error("Expected the first slot.");
    expect(npAcquireCommunityRealtimeStream("default", env)).toEqual({
      accepted: false,
      reason: "site",
      retryAfterSeconds: NP_COMMUNITY_REALTIME_RETRY_AFTER_SECONDS,
    });
    const secondSite = npAcquireCommunityRealtimeStream("community", env);
    expect(secondSite.accepted).toBe(true);

    first.lease.release();
    if (secondSite.accepted) secondSite.lease.release();
    expect(npGetCommunityRealtimeCapacitySnapshot(env)).toEqual(
      expect.objectContaining({
        activeStreams: 0,
        activeSites: 0,
        admittedStreams: 2,
        rejectedStreams: 1,
        peakActiveStreams: 2,
      }),
    );
  });

  it("enforces the process limit and releases leases idempotently", () => {
    const env = {
      NP_COMMUNITY_REALTIME_MAX_STREAMS: "1",
      NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS: "1",
    };
    const first = npAcquireCommunityRealtimeStream("default", env);
    if (!first.accepted) throw new Error("Expected the first slot.");
    expect(npAcquireCommunityRealtimeStream("community", env)).toEqual(
      expect.objectContaining({ accepted: false, reason: "process" }),
    );

    first.lease.release();
    first.lease.release();
    const replacement = npAcquireCommunityRealtimeStream("community", env);
    expect(replacement.accepted).toBe(true);
    if (replacement.accepted) replacement.lease.release();
    expect(npGetCommunityRealtimeCapacitySnapshot(env).activeStreams).toBe(0);
  });

  it("shares admission state across server module re-evaluation", async () => {
    const env = {
      NP_COMMUNITY_REALTIME_MAX_STREAMS: "2",
      NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS: "2",
    };
    const admission = npAcquireCommunityRealtimeStream("default", env);
    if (!admission.accepted) throw new Error("Expected the first slot.");

    vi.resetModules();
    const reloaded = await import("./community-realtime-capacity.js");
    expect(reloaded.npGetCommunityRealtimeCapacitySnapshot(env).activeStreams).toBe(1);
    admission.lease.release();
    expect(reloaded.npGetCommunityRealtimeCapacitySnapshot(env).activeStreams).toBe(0);
  });

  it("rejects non-canonical site ids before mutating counters", () => {
    expect(() => npAcquireCommunityRealtimeStream("Bad Site", {})).toThrow("canonical site id");
    expect(npGetCommunityRealtimeCapacitySnapshot({})).toEqual(
      expect.objectContaining({
        activeStreams: 0,
        admittedStreams: 0,
        rejectedStreams: 0,
      }),
    );
  });
});
