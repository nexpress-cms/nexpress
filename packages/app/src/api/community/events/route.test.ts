import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  list: vi.fn(),
  resolveCursor: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  NpServiceUnavailableError: class NpServiceUnavailableError extends Error {
    readonly code = "SERVICE_UNAVAILABLE";
    readonly statusCode = 503;
  },
}));

vi.mock("@nexpress/core/community", () => ({
  npListCommunityRealtimeEvents: runtime.list,
  npRequireReadableCommunityDocument: vi.fn(() => Promise.resolve()),
  npResolveCommunityRealtimeCursor: runtime.resolveCursor,
  npResolveDocumentCommunityTarget: vi.fn(() => Promise.resolve({ collection: {}, document: {} })),
}));

vi.mock("@nexpress/core/community-contract", () => ({
  npRequireCommunityRealtimeSubscription: (value: unknown) => value,
}));

vi.mock("@nexpress/core/sites", () => ({
  npIsCanonicalSiteId: (value: unknown) =>
    typeof value === "string" && /^[a-z][a-z0-9-]{0,62}$/u.test(value),
  requireSiteId: vi.fn(() => Promise.resolve("default")),
}));

vi.mock("../../../lib/init-core", () => ({
  ensureFor: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../lib/api-response", () => ({
  npErrorResponse: (error: { message: string; statusCode?: number }, init?: ResponseInit) =>
    Response.json(
      {
        error: { code: "SERVICE_UNAVAILABLE", message: error.message },
        status: error.statusCode ?? 500,
      },
      { ...init, status: error.statusCode ?? 500 },
    ),
}));

vi.mock("../../../lib/community-contract", () => ({
  npRequireCommunityRequest: (_validator: unknown, value: unknown) => value,
}));

vi.mock("../../../lib/member-auth-helpers", () => ({
  optionalMember: vi.fn(() => Promise.resolve(null)),
  requireMember: vi.fn(() => Promise.reject(new Error("not used"))),
}));

import {
  npGetCommunityRealtimeCapacitySnapshot,
  npResetCommunityRealtimeCapacityForTests,
} from "../../../lib/community-realtime-capacity.js";
import { GET } from "./route.js";

const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const URL = `http://localhost:3000/api/community/events?scope=document&targetType=posts&targetId=${TARGET_ID}`;

beforeEach(() => {
  vi.stubEnv("NP_COMMUNITY_REALTIME_MAX_STREAMS", "1");
  vi.stubEnv("NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS", "1");
  npResetCommunityRealtimeCapacityForTests();
  runtime.list.mockReset().mockResolvedValue({
    events: [],
    cursor: { id: null, sequence: 0 },
  });
  runtime.resolveCursor.mockReset().mockResolvedValue({ id: null, sequence: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  npResetCommunityRealtimeCapacityForTests();
});

describe("community realtime stream lifecycle", () => {
  it("releases an aborted request without waiting for the stream timeout", async () => {
    const abort = new AbortController();
    const response = await GET(new NextRequest(URL, { signal: abort.signal }));
    expect(npGetCommunityRealtimeCapacitySnapshot().activeStreams).toBe(1);

    abort.abort();
    await vi.waitFor(() => {
      expect(npGetCommunityRealtimeCapacitySnapshot().activeStreams).toBe(0);
    });
    await response.body?.cancel();
  });

  it("records polling failures and releases the slot", async () => {
    runtime.list.mockRejectedValueOnce(new Error("poll failed"));
    const response = await GET(new NextRequest(URL));

    await vi.waitFor(() => {
      expect(npGetCommunityRealtimeCapacitySnapshot()).toEqual(
        expect.objectContaining({
          activeStreams: 0,
          pollFailures: 1,
        }),
      );
    });
    await expect(response.body?.getReader().read()).rejects.toThrow("poll failed");
  });

  it("releases the slot after 25 seconds even when the wall clock is frozen", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    let response: Response | undefined;
    try {
      response = await GET(new NextRequest(URL));
      await vi.advanceTimersByTimeAsync(24_999);
      expect(npGetCommunityRealtimeCapacitySnapshot().activeStreams).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(npGetCommunityRealtimeCapacitySnapshot()).toEqual(
        expect.objectContaining({ activeStreams: 0, pollFailures: 0 }),
      );
      expect(await response.text()).toContain(": connected");
    } finally {
      try {
        if (response && !response.bodyUsed) await response.body?.cancel();
      } finally {
        wallClock.mockRestore();
      }
    }
  });

  it("sends heartbeats every 10 seconds while keeping their wall-clock timestamp", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const now = 1_800_000_000_000;
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(now);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await GET(new NextRequest(URL));
      if (!response.body) throw new Error("Expected an event stream");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toContain(": connected");

      let received = false;
      const first = reader.read().then((chunk) => {
        received = true;
        return chunk;
      });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(received).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(received).toBe(true);
      expect(decoder.decode((await first).value)).toBe(`: heartbeat ${now.toString()}\n\n`);

      received = false;
      const second = reader.read().then((chunk) => {
        received = true;
        return chunk;
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(received).toBe(true);
      expect(decoder.decode((await second).value)).toBe(`: heartbeat ${now.toString()}\n\n`);
      await reader.cancel();
      expect(npGetCommunityRealtimeCapacitySnapshot().activeStreams).toBe(0);
    } finally {
      try {
        await reader?.cancel();
      } finally {
        wallClock.mockRestore();
      }
    }
  });

  it("closes a non-consuming stream when its exact byte queue fills", async () => {
    vi.useFakeTimers();
    let sequence = 0;
    runtime.list.mockImplementation(() => {
      sequence += 100;
      return Promise.resolve({
        events: Array.from({ length: 100 }, (_, index) => ({
          version: 1,
          id: `00000000-0000-4000-8000-${(sequence + index).toString().padStart(12, "0")}`,
          kind: "comments.changed",
          occurredAt: "2026-07-28T00:00:00.000Z",
        })),
        cursor: {
          id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
          sequence,
        },
      });
    });

    const response = await GET(new NextRequest(URL));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(npGetCommunityRealtimeCapacitySnapshot()).toEqual(
      expect.objectContaining({
        activeStreams: 0,
        backpressureCloses: 1,
        pollFailures: 0,
      }),
    );
    expect(runtime.list.mock.calls.length).toBeGreaterThan(1);
    await response.body?.cancel();
  });
});
