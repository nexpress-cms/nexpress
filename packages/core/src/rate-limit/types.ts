/**
 * Phase 23.7 — pluggable rate-limiter adapter contract.
 *
 * The framework exposes a single `check(key, limit, windowMs)`
 * call against the configured adapter; the proxy/middleware layer
 * doesn't know whether the bucket is in-process, in Redis, or in
 * a CDN's edge worker. That keeps `apps/web/src/proxy.ts` neutral
 * to topology — single-node deploys keep the in-memory adapter,
 * multi-node deploys swap in `@nexpress/rate-limiter-redis` (or
 * any other implementation) at boot.
 *
 * The interface is intentionally tiny:
 *   - one method
 *   - synchronous-feeling shape but always async (Redis is)
 *   - no notion of bucket creation or expiry inspection
 *
 * That matches what NexPress's middleware actually needs and avoids
 * baking assumptions about, e.g., sliding-window vs fixed-window
 * semantics into the contract. Adapters pick whichever fits.
 */

export interface NxRateLimitDecision {
  /** True when the request should be rejected (count exceeded). */
  limited: boolean;
  /**
   * Seconds until the bucket resets. Set even when `limited` is
   * false so callers can surface a `RateLimit-Reset` header (some
   * clients expect it on every response, not just 429s). Adapters
   * unable to compute it can omit the field — callers must tolerate
   * missing values.
   */
  retryAfterSeconds?: number;
}

export interface NxRateLimiterAdapter {
  /**
   * Increment the bucket identified by `key` and return whether
   * the resulting count exceeds `limit` within `windowMs`.
   *
   * Implementations should make the increment-and-test
   * indivisible *within their concurrency model*:
   *   - The default `InMemoryRateLimiter` relies on Node's
   *     single-threaded event loop — concurrent `check`s on the
   *     same Map key serialize naturally. Worker-thread or
   *     multi-process consumers need a different adapter.
   *   - `RedisRateLimiter` uses a Lua script so an `INCR` and
   *     its TTL arm happen in a single Redis call.
   *
   * `key` is opaque to the adapter — the framework composes it
   * from (ip, route-pattern). Adapters should treat it as a
   * binary-safe string and not parse it.
   */
  check(key: string, limit: number, windowMs: number): Promise<NxRateLimitDecision>;
  /**
   * Optional teardown hook for adapters that hold network
   * connections or background timers (Redis client, cleanup
   * intervals). Called by the bootstrap layer at process
   * shutdown so e.g. a Redis pool drains cleanly. The framework
   * never invokes this on the in-memory adapter — the cleanup
   * timer there lives on `globalThis` for HMR durability.
   */
  shutdown?(): Promise<void>;
}
