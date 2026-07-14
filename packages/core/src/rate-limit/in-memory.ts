import type { NpRateLimitDecision, NpRateLimiterAdapter, NpRateLimitRequest } from "./types.js";
import { npRequireRateLimitRequest } from "./contract.js";

/**
 * Default rate-limiter adapter. Same fixed-window behaviour the
 * proxy already had before this lived behind an interface — a
 * request in the first ms and one in the last ms of a window
 * share the bucket. Single-node deploys keep this; multi-node
 * deploys swap in `@nexpress/rate-limiter-redis` (or another
 * adapter) from the proxy entrypoint.
 *
 * Why store + janitor on `globalThis`: HMR re-evaluates this
 * module on every save in dev, and a module-scoped Map would
 * orphan the previous one from its cleanup interval (#315).
 * Pinning both to `globalThis` keeps Map and janitor paired
 * across reloads.
 *
 * Why the janitor arms lazily: importing this file alone
 * shouldn't keep a Node process alive. CLI / one-shot scripts
 * that pull in `@nexpress/core` for unrelated reasons shouldn't
 * inherit a 60-second timer.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

declare global {
  var __nx_rate_limit_store: Map<string, Bucket> | undefined;
  var __nx_rate_limit_cleanup_handle: NodeJS.Timeout | undefined;
}

function getStore(): Map<string, Bucket> {
  let store = globalThis.__nx_rate_limit_store;
  if (!store) {
    store = new Map<string, Bucket>();
    globalThis.__nx_rate_limit_store = store;
  }
  return store;
}

function ensureJanitor(): void {
  if (globalThis.__nx_rate_limit_cleanup_handle) return;
  const handle = setInterval(() => {
    const liveStore = globalThis.__nx_rate_limit_store;
    if (!liveStore) return;
    const now = Date.now();
    for (const [key, bucket] of liveStore) {
      if (now >= bucket.resetAt) liveStore.delete(key);
    }
  }, 60_000);
  // Don't keep a Node process alive just to prune empty buckets.
  handle.unref?.();
  globalThis.__nx_rate_limit_cleanup_handle = handle;
}

export class InMemoryRateLimiter implements NpRateLimiterAdapter {
  readonly kind = "memory";

  constructor() {
    ensureJanitor();
  }

  check(key: string, limit: number, windowMs: number): Promise<NpRateLimitDecision> {
    let request: NpRateLimitRequest;
    try {
      request = npRequireRateLimitRequest({ key, limit, windowMs });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const store = getStore();
    const now = Date.now();
    const bucket = store.get(request.key);
    if (!bucket || now >= bucket.resetAt) {
      store.set(request.key, { count: 1, resetAt: now + request.windowMs });
      return Promise.resolve({
        limited: false,
        retryAfterSeconds: Math.ceil(request.windowMs / 1000),
      });
    }
    bucket.count += 1;
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    if (bucket.count > request.limit) {
      return Promise.resolve({ limited: true, retryAfterSeconds });
    }
    return Promise.resolve({ limited: false, retryAfterSeconds });
  }
}

/**
 * Test-only: clear the in-memory store. Not part of the public
 * surface — tests inside `@nexpress/core` reach for it via the
 * direct file import; downstream consumers shouldn't.
 */
export function __resetInMemoryRateLimitStoreForTests(): void {
  globalThis.__nx_rate_limit_store?.clear();
}
