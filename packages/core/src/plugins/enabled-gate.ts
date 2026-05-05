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
let ttlMs = DEFAULT_TTL_MS;

async function fetchEnabled(pluginId: string): Promise<boolean> {
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

  const promise = fetchEnabled(pluginId)
    .then((enabled) => {
      cache.set(pluginId, { enabled, expiresAt: Date.now() + ttlMs });
      return enabled;
    })
    .finally(() => {
      inflight.delete(pluginId);
    });
  inflight.set(pluginId, promise);
  return promise;
}

export function invalidatePluginEnabled(pluginId: string): void {
  cache.delete(pluginId);
  inflight.delete(pluginId);
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
  ttlMs = DEFAULT_TTL_MS;
}

/** Test-only: tighten the TTL so cache-expiry behavior is observable. */
export function setEnabledGateTtlForTest(ms: number): void {
  ttlMs = ms;
}
