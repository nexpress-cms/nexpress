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

  it("releases the slot at the bounded stream timeout", async () => {
    vi.useFakeTimers();
    const response = await GET(new NextRequest(URL));
    expect(npGetCommunityRealtimeCapacitySnapshot().activeStreams).toBe(1);

    await vi.advanceTimersByTimeAsync(26_000);
    expect(npGetCommunityRealtimeCapacitySnapshot().activeStreams).toBe(0);
    await response.body?.cancel();
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
