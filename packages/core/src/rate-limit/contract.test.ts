import { describe, expect, it } from "vitest";

import {
  npAnalyzeRateLimitDecision,
  npAnalyzeRateLimitRequest,
  npReadRateLimitRuntimeConfig,
  npRequireRateLimiterAdapter,
} from "./contract.js";

const request = { key: "203.0.113.1:^/api/auth/", limit: 10, windowMs: 60_000 };

describe("rate-limit runtime contract", () => {
  it("accepts one exact request and rejects widened or unbounded values", () => {
    expect(npAnalyzeRateLimitRequest(request)).toEqual([]);
    expect(npAnalyzeRateLimitRequest({ ...request, extra: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]),
    );
    for (const invalid of [0, -1, 1.5, Number.NaN]) {
      expect(npAnalyzeRateLimitRequest({ ...request, limit: invalid })).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "rateLimit.request.limit" })]),
      );
    }
    expect(npAnalyzeRateLimitRequest({ ...request, key: "" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "rateLimit.request.key" })]),
    );
  });

  it("requires an exact decision with one bounded positive retry value", () => {
    expect(npAnalyzeRateLimitDecision({ limited: true, retryAfterSeconds: 60 }, request)).toEqual(
      [],
    );
    expect(npAnalyzeRateLimitDecision({ limited: true }, request)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "rateLimit.decision.retryAfterSeconds" }),
      ]),
    );
    expect(
      npAnalyzeRateLimitDecision({ limited: false, retryAfterSeconds: 61, remaining: 9 }, request),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-field" }),
        expect.objectContaining({ path: "rateLimit.decision.retryAfterSeconds" }),
      ]),
    );
  });

  it("requires a canonical kind, check function, and optional shutdown function", () => {
    expect(
      npRequireRateLimiterAdapter({
        kind: "redis-cluster",
        check: () => Promise.resolve({ limited: false, retryAfterSeconds: 60 }),
      }),
    ).toEqual(expect.objectContaining({ kind: "redis-cluster" }));
    expect(() => npRequireRateLimiterAdapter({ kind: "Redis", check: () => undefined })).toThrow(
      /rateLimit\.adapter\.kind/u,
    );
    expect(() => npRequireRateLimiterAdapter({ kind: "custom" })).toThrow(
      /rateLimit\.adapter\.check/u,
    );
    expect(() =>
      npRequireRateLimiterAdapter({ kind: "custom", check: () => undefined, shutdown: true }),
    ).toThrow(/rateLimit\.adapter\.shutdown/u);
  });

  it("parses the exact runtime adapter intent", () => {
    expect(npReadRateLimitRuntimeConfig({})).toEqual({ adapter: "memory" });
    expect(npReadRateLimitRuntimeConfig({ NP_RATE_LIMIT_ADAPTER: "memory" })).toEqual({
      adapter: "memory",
    });
    expect(npReadRateLimitRuntimeConfig({ NP_RATE_LIMIT_ADAPTER: "custom" })).toEqual({
      adapter: "custom",
    });
    expect(() => npReadRateLimitRuntimeConfig({ NP_RATE_LIMIT_ADAPTER: "redis" })).toThrow(
      /NP_RATE_LIMIT_ADAPTER/u,
    );
  });
});
