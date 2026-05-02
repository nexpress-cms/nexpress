import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";

import { RedisRateLimiter } from "./index.js";

/**
 * The unit suite stubs the `eval` call rather than booting a real
 * Redis. The Lua semantics belong in an integration test against a
 * live Redis (Phase 23.7.1 follow-up); here we pin the *adapter*
 * surface — it issues one EVAL per check, derives `limited` from
 * the returned count, and computes `retryAfterSeconds` from the
 * TTL.
 */

function fakeClient(eval_: (...args: unknown[]) => Promise<unknown>): Redis {
  const partial: Partial<Redis> = {
    eval: eval_ as unknown as Redis["eval"],
    quit: vi.fn().mockResolvedValue("OK") as unknown as Redis["quit"],
  };
  return partial as Redis;
}

describe("RedisRateLimiter", () => {
  it("admits the first request inside an empty window", async () => {
    const evalStub = vi.fn().mockResolvedValue([1, 60_000]);
    const limiter = new RedisRateLimiter({ client: fakeClient(evalStub) });
    const decision = await limiter.check("ip-1:/api/auth", 10, 60_000);
    expect(decision.limited).toBe(false);
    expect(decision.retryAfterSeconds).toBe(60);
    expect(evalStub).toHaveBeenCalledTimes(1);
  });

  it("rejects when the returned count exceeds the limit", async () => {
    const evalStub = vi.fn().mockResolvedValue([11, 30_000]);
    const limiter = new RedisRateLimiter({ client: fakeClient(evalStub) });
    const decision = await limiter.check("ip-2:/api/auth", 10, 60_000);
    expect(decision.limited).toBe(true);
    expect(decision.retryAfterSeconds).toBe(30);
  });

  it("falls back to windowMs when the script reports a non-positive TTL", async () => {
    // Defensive: if Redis returns -1 / -2 (no TTL / key missing)
    // the adapter should still report a sane retry-after rather
    // than 0 or NaN.
    const evalStub = vi.fn().mockResolvedValue([1, -1]);
    const limiter = new RedisRateLimiter({ client: fakeClient(evalStub) });
    const decision = await limiter.check("ip-3:/api", 5, 60_000);
    expect(decision.retryAfterSeconds).toBe(60);
  });

  it("string-encoded numbers from RESP are parsed correctly", async () => {
    // ioredis returns strings for some replies depending on
    // pipeline / cluster configuration. The adapter must accept
    // both number and string shapes without falling over.
    const evalStub = vi.fn().mockResolvedValue(["3", "45000"]);
    const limiter = new RedisRateLimiter({ client: fakeClient(evalStub) });
    const decision = await limiter.check("ip-4:/api", 5, 60_000);
    expect(decision.limited).toBe(false);
    expect(decision.retryAfterSeconds).toBe(45);
  });

  it("prefixes keys with `nx:rl:` by default", async () => {
    const evalStub = vi.fn().mockResolvedValue([1, 60_000]);
    const limiter = new RedisRateLimiter({ client: fakeClient(evalStub) });
    await limiter.check("ip-5:/api", 5, 60_000);
    const args = evalStub.mock.calls[0];
    // `eval(script, numkeys, ...KEYS, ...ARGV)`. The third arg is
    // the first KEY entry.
    expect(args?.[2]).toBe("nx:rl:ip-5:/api");
  });

  it("respects a caller-supplied keyPrefix", async () => {
    const evalStub = vi.fn().mockResolvedValue([1, 60_000]);
    const limiter = new RedisRateLimiter({
      client: fakeClient(evalStub),
      keyPrefix: "myapp:",
    });
    await limiter.check("ip-6:/api", 5, 60_000);
    expect(evalStub.mock.calls[0]?.[2]).toBe("myapp:ip-6:/api");
  });

  it("shutdown does not close a caller-supplied client", async () => {
    const evalStub = vi.fn().mockResolvedValue([1, 60_000]);
    const quitStub = vi.fn().mockResolvedValue("OK");
    // Build the partial Redis manually so the spy is the same
    // reference we assert on (avoiding `unbound-method` against
    // the casted Redis type).
    const client = {
      eval: evalStub as unknown as Redis["eval"],
      quit: quitStub as unknown as Redis["quit"],
    } as Redis;
    const limiter = new RedisRateLimiter({ client });
    await limiter.shutdown();
    expect(quitStub).not.toHaveBeenCalled();
  });
});
