import type { NxRateLimitDecision, NxRateLimiterAdapter } from "./types.js";

/**
 * Phase 23.7 — default adapter. Drop-in replacement for the
 * pre-extraction `Map<string, RateLimitEntry>` that lived inside
 * `apps/web/src/proxy.ts`. Keeps the same fixed-window behavior
 * (a request in the first millisecond and one in the last share
 * the bucket) so single-node deploys see no behavior change after
 * the swap.
 *
 * The store + the cleanup timer both live on `globalThis` to
 * survive HMR re-evaluation in dev — same constraint as the
 * extracted code (#315). Two adapter instances created in the
 * same process therefore share state. That's intentional: if the
 * caller wires two parallel limiters they're almost certainly
 * doing it by accident, and silent drift between them would be
 * worse than visible coupling.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

declare global {
  var __nx_rate_limit_store: Map<string, Bucket> | undefined;
  var __nx_rate_limit_cleanup_started: boolean | undefined;
}

const store: Map<string, Bucket> =
  globalThis.__nx_rate_limit_store ?? new Map<string, Bucket>();
globalThis.__nx_rate_limit_store = store;

if (!globalThis.__nx_rate_limit_cleanup_started) {
  globalThis.__nx_rate_limit_cleanup_started = true;
  setInterval(() => {
    const liveStore = globalThis.__nx_rate_limit_store;
    if (!liveStore) return;
    const now = Date.now();
    for (const [key, bucket] of liveStore) {
      if (now > bucket.resetAt) liveStore.delete(key);
    }
  }, 60_000);
}

export class InMemoryRateLimiter implements NxRateLimiterAdapter {
  // The body is synchronous — buckets live in the in-process Map.
  // We return a resolved Promise rather than marking `async` so the
  // adapter's signature still matches the contract without producing
  // an empty `await` warning under typed lint.
  check(key: string, limit: number, windowMs: number): Promise<NxRateLimitDecision> {
    const now = Date.now();
    const bucket = store.get(key);
    if (!bucket || now > bucket.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return Promise.resolve({
        limited: false,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      });
    }
    bucket.count += 1;
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    if (bucket.count > limit) {
      return Promise.resolve({ limited: true, retryAfterSeconds });
    }
    return Promise.resolve({ limited: false, retryAfterSeconds });
  }
}

/**
 * Test-only: clear the in-memory store. Exposed because
 * unit tests want to assert against a fresh bucket without
 * waiting `windowMs` between cases. Callers in production
 * code SHOULD NOT use this.
 */
export function __resetInMemoryRateLimitStoreForTests(): void {
  store.clear();
}
