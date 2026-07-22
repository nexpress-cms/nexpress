import { and, eq } from "drizzle-orm";

import { npSitePlugins } from "../db/schema/system.js";
import { getDb } from "../db/runtime.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID, npIsCanonicalSiteId } from "../sites/id-contract.js";

/**
 * Per-request enabled gate for already-loaded plugins.
 *
 * The plugin host registers every configured hook and route at boot regardless
 * of the `np_site_plugins.enabled` row state. This module fronts the registry
 * with a short-lived cache of the site-specific DB flag so dispatch sites
 * (`runHook`, the catch-all route handler, `dispatchPluginAction`) can skip
 * disabled plugins immediately, without paying a DB round-trip per call.
 *
 * Cache semantics:
 *  - Default-enabled: a missing activation override OR a DB read failure yields
 *    `true`. This keeps the sparse activation table small and avoids a hard
 *    failure mode where a flaky DB silently disables every plugin.
 *  - 5 second TTL by default — short enough that a toggle feels immediate,
 *    long enough to absorb a burst of hook calls within one request.
 *  - `invalidatePluginEnabled(id, siteId)` is called from `updatePluginState`
 *    so the next dispatch for that site re-reads the DB instead of waiting out
 *    the TTL. Omitting `siteId` clears every known site entry for the plugin.
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

function cacheKey(siteId: string, pluginId: string): string {
  return `${siteId}\u0000${pluginId}`;
}

function currentGeneration(key: string): number {
  return generation.get(key) ?? 0;
}

async function resolveSiteId(siteId?: string): Promise<string> {
  const resolved = siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  if (!npIsCanonicalSiteId(resolved)) {
    throw new Error("Plugin activation site id is not canonical.");
  }
  return resolved;
}

async function fetchEnabled(siteId: string, pluginId: string): Promise<boolean> {
  if (fetchOverride) return fetchOverride(pluginId, siteId);
  try {
    const db = getDb();
    const rows = await db
      .select({ enabled: npSitePlugins.enabled })
      .from(npSitePlugins)
      .where(and(eq(npSitePlugins.siteId, siteId), eq(npSitePlugins.pluginId, pluginId)))
      .limit(1);
    const row = rows[0] as { enabled?: unknown } | undefined;
    if (row && typeof row.enabled === "boolean") {
      return row.enabled;
    }
    // Sparse activation override missing — active by default.
    return true;
  } catch {
    // DB not ready (test, CLI scaffold) or transient failure — fail open so
    // a degraded DB can't silently disable every loaded plugin.
    return true;
  }
}

export async function isPluginEnabled(pluginId: string, siteId?: string): Promise<boolean> {
  const resolvedSiteId = await resolveSiteId(siteId);
  const key = cacheKey(resolvedSiteId, pluginId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.enabled;
  }

  // Coalesce concurrent lookups for the same id so a hook that fans out
  // doesn't fire N parallel SELECTs against the same row.
  const existing = inflight.get(key);
  if (existing) return existing;

  // Capture the generation BEFORE awaiting. If the cache is invalidated
  // while we're in flight, the generation map will tick and the .then()
  // below skips the cache write.
  const fetchGeneration = currentGeneration(key);
  const promise = fetchEnabled(resolvedSiteId, pluginId)
    .then((enabled) => {
      if (currentGeneration(key) === fetchGeneration) {
        cache.set(key, { enabled, expiresAt: Date.now() + ttlMs });
      }
      return enabled;
    })
    .finally(() => {
      // Only clear the inflight slot if it's still ours — a concurrent
      // invalidate may have cleared and a sibling request may have
      // installed a fresh promise. Don't yank theirs.
      if (inflight.get(key) === promise) {
        inflight.delete(key);
      }
    });
  inflight.set(key, promise);
  return promise;
}

export function invalidatePluginEnabled(pluginId: string, siteId?: string): void {
  const keys = siteId
    ? [cacheKey(siteId, pluginId)]
    : [...new Set([...cache.keys(), ...inflight.keys(), ...generation.keys()])].filter((key) =>
        key.endsWith(`\u0000${pluginId}`),
      );
  for (const key of keys) {
    cache.delete(key);
    inflight.delete(key);
    // Tick the generation so any already-running fetchEnabled() promise
    // for this site/plugin refuses to write its result back into the cache.
    generation.set(key, currentGeneration(key) + 1);
  }
}

/**
 * Test-only: bypass the DB and force a known enabled value. The cache holds
 * it for the configured TTL so subsequent reads in the same test see the
 * forced value without hitting the DB stub.
 */
export function setPluginEnabledForTest(
  pluginId: string,
  enabled: boolean,
  siteId = NP_DEFAULT_SITE_ID,
): void {
  cache.set(cacheKey(siteId, pluginId), { enabled, expiresAt: Number.POSITIVE_INFINITY });
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
let fetchOverride: ((pluginId: string, siteId: string) => Promise<boolean>) | null = null;

export function setFetchImplForTest(
  impl: ((pluginId: string, siteId: string) => Promise<boolean>) | null,
): void {
  fetchOverride = impl;
}
