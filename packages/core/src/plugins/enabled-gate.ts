import { eq } from "drizzle-orm";

import { npPlugins } from "../db/schema/system.js";
import { getDb } from "../db/runtime.js";

/**
 * Per-request enabled gate for already-loaded plugins.
 *
 * The plugin host registers every hook and route at boot regardless of the
 * `np_plugins.enabled` row state, so toggling a plugin from the admin UI
 * historically required a server restart to take effect. This module fronts
 * the registry with a short-lived cache of the DB flag so dispatch sites
 * (`runHook`, the catch-all route handler, `dispatchPluginAction`) can skip
 * disabled plugins immediately, without paying a DB round-trip per call.
 *
 * Cache semantics:
 *  - Default-enabled: a missing row OR a DB read failure yields `true`. This
 *    matches `syncPluginRegistrations` (which inserts new rows with
 *    `enabled=true`) and avoids a hard failure mode where a flaky DB silently
 *    disables every plugin.
 *  - 5 second TTL by default — short enough that a toggle feels immediate,
 *    long enough to absorb a burst of hook calls within one request.
 *  - `invalidatePluginEnabled(id)` is called from `updatePluginState` so the
 *    next dispatch after a toggle re-reads the DB instead of waiting out the
 *    TTL.
 *  - `setPluginEnabledForTest()` / `resetEnabledGate()` let unit tests
 *    bypass the DB entirely.
 */

const DEFAULT_TTL_MS = 5_000;

interface CacheEntry {
  enabled: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<boolean>>();
/**
 * Per-plugin generation counter. Bumped by `invalidatePluginEnabled()` so
 * an in-flight `fetchEnabled()` can tell whether its result is still
 * relevant before writing to the cache. Without this token, the original
 * implementation (#462) had a race:
 *   T0 — request A starts fetchEnabled, reads `enabled=true` from DB
 *   T1 — admin toggles → invalidate clears cache + inflight
 *   T2 — request B starts a fresh fetchEnabled, reads `enabled=false`,
 *        writes `false` to cache
 *   T3 — A's `.then()` finally runs and overwrites cache with the
 *        stale `true`, sticking until the TTL expires
 * Now A bumps its captured generation against the current value before
 * writing; if they disagree, A drops its result.
 */
const generation = new Map<string, number>();
let ttlMs = DEFAULT_TTL_MS;

function currentGeneration(pluginId: string): number {
  return generation.get(pluginId) ?? 0;
}

async function fetchEnabled(pluginId: string): Promise<boolean> {
  if (fetchOverride) return fetchOverride(pluginId);
  try {
    const db = getDb();
    const rows = await db
      .select({ enabled: npPlugins.enabled })
      .from(npPlugins)
      .where(eq(npPlugins.id, pluginId))
      .limit(1);
    const row = rows[0] as { enabled?: unknown } | undefined;
    if (row && typeof row.enabled === "boolean") {
      return row.enabled;
    }
    // Row missing — treat as enabled. `syncPluginRegistrations` will insert
    // the row with enabled=true on the next boot anyway.
    return true;
  } catch {
    // DB not ready (test, CLI scaffold) or transient failure — fail open so
    // a degraded DB can't silently disable every loaded plugin.
    return true;
  }
}

export async function isPluginEnabled(pluginId: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(pluginId);
  if (cached && cached.expiresAt > now) {
    return cached.enabled;
  }

  // Coalesce concurrent lookups for the same id so a hook that fans out
  // doesn't fire N parallel SELECTs against the same row.
  const existing = inflight.get(pluginId);
  if (existing) return existing;

  // Capture the generation BEFORE awaiting. If the cache is invalidated
  // while we're in flight, the generation map will tick and the .then()
  // below skips the cache write.
  const fetchGeneration = currentGeneration(pluginId);
  const promise = fetchEnabled(pluginId)
    .then((enabled) => {
      if (currentGeneration(pluginId) === fetchGeneration) {
        cache.set(pluginId, { enabled, expiresAt: Date.now() + ttlMs });
      }
      return enabled;
    })
    .finally(() => {
      // Only clear the inflight slot if it's still ours — a concurrent
      // invalidate may have cleared and a sibling request may have
      // installed a fresh promise. Don't yank theirs.
      if (inflight.get(pluginId) === promise) {
        inflight.delete(pluginId);
      }
    });
  inflight.set(pluginId, promise);
  return promise;
}

export function invalidatePluginEnabled(pluginId: string): void {
  cache.delete(pluginId);
  inflight.delete(pluginId);
  // Tick the generation so any already-running fetchEnabled() promise
  // for this id refuses to write its result back into the cache when
  // it eventually settles. Without the bump, a slow DB read started
  // before the toggle could re-cache the stale value for up to TTL.
  generation.set(pluginId, currentGeneration(pluginId) + 1);
}

/**
 * Test-only: bypass the DB and force a known enabled value. The cache holds
 * it for the configured TTL so subsequent reads in the same test see the
 * forced value without hitting the DB stub.
 */
export function setPluginEnabledForTest(pluginId: string, enabled: boolean): void {
  cache.set(pluginId, { enabled, expiresAt: Number.POSITIVE_INFINITY });
}

export function resetEnabledGate(): void {
  cache.clear();
  inflight.clear();
  generation.clear();
  ttlMs = DEFAULT_TTL_MS;
  fetchOverride = null;
}

/** Test-only: tighten the TTL so cache-expiry behavior is observable. */
export function setEnabledGateTtlForTest(ms: number): void {
  ttlMs = ms;
}

/**
 * Test-only: replace the DB read with a deterministic implementation so
 * race-window tests can resolve fetches in a controlled order. Production
 * code goes through `fetchEnabled()` directly; the override is wired in
 * via this setter and torn down by `resetEnabledGate()`.
 */
let fetchOverride: ((pluginId: string) => Promise<boolean>) | null = null;

export function setFetchImplForTest(
  impl: ((pluginId: string) => Promise<boolean>) | null,
): void {
  fetchOverride = impl;
}
