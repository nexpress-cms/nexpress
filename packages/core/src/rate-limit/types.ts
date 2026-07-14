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

export interface NpRateLimitDecision {
  /** True when the request should be rejected (count exceeded). */
  readonly limited: boolean;
  /**
   * Positive whole seconds until the bucket resets. Required on
   * every decision so a blocked request can always emit one valid
   * `Retry-After` header. An adapter that cannot inspect its store's
   * TTL should return `Math.ceil(windowMs / 1000)`.
   */
  readonly retryAfterSeconds: number;
}

/** Exact input validated before an adapter is dispatched. */
export interface NpRateLimitRequest {
  /** Opaque, bounded bucket key. Adapters must not parse it. */
  readonly key: string;
  /** Maximum admitted checks in the current window. */
  readonly limit: number;
  /** Fixed-window duration in milliseconds. */
  readonly windowMs: number;
}

export interface NpRateLimiterAdapter {
  /** Canonical lowercase identifier used by diagnostics. */
  readonly kind: string;
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
  check(key: string, limit: number, windowMs: number): Promise<NpRateLimitDecision>;
  /**
   * Optional teardown hook for adapters that hold network
   * connections or background timers (Redis client, cleanup
   * intervals). Registry consumers call `npShutdownRateLimiter()`;
   * directly injected proxy adapters retain caller-owned lifecycle.
   * The in-memory adapter needs no hook because its cleanup timer
   * lives on `globalThis` for HMR durability.
   */
  shutdown?(): Promise<void>;
}

/** Operator intent shared by proxy boot, startup safety, and doctor. */
export type NpRateLimitRuntimeConfig =
  { readonly adapter: "memory" } | { readonly adapter: "custom" };
