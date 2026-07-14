import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryRateLimiter, __resetInMemoryRateLimitStoreForTests } from "./in-memory.js";
// __reset is intentionally only reachable from the file import here,
// not the subpath barrel — keeping the test hatch out of the v0.1
// public surface.
import {
  getOptionalRateLimiter,
  getRateLimiter,
  npCheckRateLimit,
  npShutdownRateLimiter,
  setRateLimiter,
} from "./registry.js";

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
    expect(limiter.kind).toBe("memory");
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

  it("rejects malformed direct adapter input before touching a bucket", async () => {
    const limiter = new InMemoryRateLimiter();
    await expect(limiter.check("", 0, -1)).rejects.toThrow(/rateLimit\.request\.key/u);
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
      kind: "custom",
      check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 1 }),
    };
    setRateLimiter(stub);
    const result = await getRateLimiter().check("k", 1, 1);
    expect(result.limited).toBe(false);
    expect(stub.check).toHaveBeenCalledWith("k", 1, 1);
  });

  it("validates registration, requests, and adapter results", async () => {
    expect(() => setRateLimiter({ check: vi.fn() } as never)).toThrow(/rateLimit\.adapter\.kind/u);
    const check = vi.fn().mockResolvedValue({ limited: false });
    setRateLimiter({ kind: "bad-result", check: check as never });
    await expect(npCheckRateLimit({ key: "k", limit: 1, windowMs: 1_000 })).rejects.toThrow(
      /retryAfterSeconds/u,
    );
    await expect(npCheckRateLimit({ key: "", limit: 1, windowMs: 1_000 })).rejects.toThrow(
      /rateLimit\.request\.key/u,
    );
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("reads the current adapter for every dispatched check", async () => {
    const first = {
      kind: "first",
      check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 1 }),
    };
    const second = {
      kind: "second",
      check: vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 1 }),
    };
    setRateLimiter(first);
    await expect(npCheckRateLimit({ key: "k", limit: 1, windowMs: 1_000 })).resolves.toEqual({
      limited: false,
      retryAfterSeconds: 1,
    });
    setRateLimiter(second);
    await expect(npCheckRateLimit({ key: "k", limit: 1, windowMs: 1_000 })).resolves.toEqual({
      limited: true,
      retryAfterSeconds: 1,
    });
    expect(first.check).toHaveBeenCalledOnce();
    expect(second.check).toHaveBeenCalledOnce();
  });

  it("detaches and shuts down the registered adapter exactly once", async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    setRateLimiter({
      kind: "custom",
      check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 1 }),
      shutdown,
    });
    await npShutdownRateLimiter();
    await npShutdownRateLimiter();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(getOptionalRateLimiter()).toBeNull();
  });

  it("rejects non-void shutdown results after detaching the adapter", async () => {
    setRateLimiter({
      kind: "bad-shutdown",
      check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 1 }),
      shutdown: vi.fn().mockResolvedValue("closed") as never,
    });
    await expect(npShutdownRateLimiter()).rejects.toThrow(/resolve to void/u);
    expect(getOptionalRateLimiter()).toBeNull();
  });
});
