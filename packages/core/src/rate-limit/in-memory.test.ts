import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryRateLimiter, __resetInMemoryRateLimitStoreForTests } from "./in-memory.js";
// __reset is intentionally only reachable from the file import here,
// not the subpath barrel — keeping the test hatch out of the v0.1
// public surface.
import { getRateLimiter, setRateLimiter, getOptionalRateLimiter } from "./registry.js";

describe("InMemoryRateLimiter", () => {
  beforeEach(() => {
    __resetInMemoryRateLimitStoreForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("admits the first request inside an empty window", async () => {
    const limiter = new InMemoryRateLimiter();
    const decision = await limiter.check("ip-1:/api/auth", 10, 60_000);
    expect(decision.limited).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rejects the request that crosses the configured limit", async () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i += 1) {
      const decision = await limiter.check("ip-2:/api/auth", 3, 60_000);
      expect(decision.limited).toBe(false);
    }
    const overflow = await limiter.check("ip-2:/api/auth", 3, 60_000);
    expect(overflow.limited).toBe(true);
    expect(overflow.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates buckets by key", async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.check("ip-A:/api", 1, 60_000);
    const blockedA = await limiter.check("ip-A:/api", 1, 60_000);
    const allowedB = await limiter.check("ip-B:/api", 1, 60_000);
    expect(blockedA.limited).toBe(true);
    expect(allowedB.limited).toBe(false);
  });

  it("resets after the window elapses", async () => {
    vi.useFakeTimers();
    const limiter = new InMemoryRateLimiter();
    await limiter.check("ip-3:/api", 1, 1_000);
    const blocked = await limiter.check("ip-3:/api", 1, 1_000);
    expect(blocked.limited).toBe(true);

    // Advance past the window so the bucket is considered fresh.
    vi.advanceTimersByTime(1_500);
    const reopened = await limiter.check("ip-3:/api", 1, 1_000);
    expect(reopened.limited).toBe(false);
  });
});

describe("rate-limiter registry", () => {
  beforeEach(() => {
    setRateLimiter(null);
  });

  it("lazily installs the in-memory default when no adapter is set", () => {
    const limiter = getRateLimiter();
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    // Subsequent reads return the same instance — the default
    // shouldn't churn buckets between requests.
    expect(getRateLimiter()).toBe(limiter);
  });

  it("getOptionalRateLimiter returns null when nothing has been registered or read", () => {
    expect(getOptionalRateLimiter()).toBeNull();
  });

  it("setRateLimiter overrides the adapter for downstream callers", async () => {
    const stub = {
      check: vi.fn().mockResolvedValue({ limited: false }),
    };
    setRateLimiter(stub);
    const result = await getRateLimiter().check("k", 1, 1);
    expect(result.limited).toBe(false);
    expect(stub.check).toHaveBeenCalledWith("k", 1, 1);
  });
});
