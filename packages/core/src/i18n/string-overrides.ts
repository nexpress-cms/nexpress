import { and, eq } from "drizzle-orm";

import { getDb } from "../collections/pipeline.js";
import { nxStringOverrides } from "../db/schema/system.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

/**
 * Phase D — admin-overridable UI string layer on top of the
 * Phase 12.5 plugin/theme bundle registry.
 *
 * Plugins and themes ship base translations via
 * `addStrings()`; admins layer overrides on top via the
 * `nx_string_overrides` table without editing plugin/theme
 * code. Per-site composite key (siteId, locale, key) so each
 * tenant can override the same plugin's string differently.
 *
 * The override map is held in-memory per process, keyed by
 * site, populated lazily by `loadStringOverridesForSite()`
 * and busted by `clearStringOverrideCacheForSite()` after
 * admin writes. Multi-process deployments live with eventual
 * consistency — workers reload from DB on their own
 * cache-miss path; that's acceptable because override edits
 * are infrequent. Sites that need strict consistency add a
 * pubsub channel later.
 */

type OverrideMap = Map<string, Record<string, string | null>>; // locale → key → value (null = explicitly cleared)

const cacheBySite = new Map<string, OverrideMap>();

/**
 * Read every override row for a site and rebuild that site's
 * cache entry from the DB. Idempotent; safe to call
 * concurrently (the writers are admin actions, not hot
 * paths).
 */
export async function loadStringOverridesForSite(
  siteId: string,
): Promise<OverrideMap> {
  const db = getDb();
  const rows = (await db
    .select({
      locale: nxStringOverrides.locale,
      key: nxStringOverrides.key,
      value: nxStringOverrides.value,
    })
    .from(nxStringOverrides)
    .where(eq(nxStringOverrides.siteId, siteId))) as Array<{
    locale: string;
    key: string;
    value: string | null;
  }>;

  const map: OverrideMap = new Map();
  for (const row of rows) {
    const bundle = map.get(row.locale) ?? {};
    bundle[row.key] = row.value;
    map.set(row.locale, bundle);
  }
  cacheBySite.set(siteId, map);
  return map;
}

/**
 * Get the cached override map for a site, loading it on a
 * cache miss. Async because the cache miss has to round-trip
 * to the DB.
 */
export async function getStringOverridesForSite(
  siteId: string,
): Promise<OverrideMap> {
  const cached = cacheBySite.get(siteId);
  if (cached) return cached;
  return loadStringOverridesForSite(siteId);
}

export function clearStringOverrideCacheForSite(siteId: string): void {
  cacheBySite.delete(siteId);
}

/** Tests use this between cases. Production never wipes globally. */
export function resetStringOverrideCache(): void {
  cacheBySite.clear();
}

/**
 * Resolve an override for a single (locale, key) on the
 * current site, or null if no override is set. Synchronous
 * after the cache is warm; the async wrapper used by `t()`
 * ensures the cache is loaded before this is called.
 */
export function getStringOverride(
  siteId: string,
  locale: string,
  key: string,
): string | null {
  const cached = cacheBySite.get(siteId);
  if (!cached) return null;
  const bundle = cached.get(locale);
  if (!bundle) return null;
  // null in the bundle means "explicitly cleared, fall back
  // to the registry"; undefined means "no override at all"
  // — both behave the same for resolution but the column
  // distinguishes them for audit-trail UIs.
  const value = bundle[key];
  return value ?? null;
}

/**
 * Persist an override row. Pass `null` for `value` to mark
 * the key as explicitly reverted (the resolution result is
 * the same as if no row existed; the row itself stays as a
 * marker for audit trails).
 */
export async function setStringOverride(
  locale: string,
  key: string,
  value: string | null,
  options?: { siteId?: string; updatedBy?: string | null },
): Promise<void> {
  const db = getDb();
  const siteId =
    options?.siteId ?? (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const now = new Date();
  await db
    .insert(nxStringOverrides)
    .values({
      siteId,
      locale,
      key,
      value,
      updatedAt: now,
      updatedBy: options?.updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [
        nxStringOverrides.siteId,
        nxStringOverrides.locale,
        nxStringOverrides.key,
      ],
      set: {
        value,
        updatedAt: now,
        updatedBy: options?.updatedBy ?? null,
      },
    });
  clearStringOverrideCacheForSite(siteId);
}

/**
 * Delete an override row (vs. setting value=null which
 * preserves the audit trail). Useful when an admin
 * explicitly wants to "stop tracking" an override.
 */
export async function deleteStringOverride(
  locale: string,
  key: string,
  options?: { siteId?: string },
): Promise<void> {
  const db = getDb();
  const siteId =
    options?.siteId ?? (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  await db
    .delete(nxStringOverrides)
    .where(
      and(
        eq(nxStringOverrides.siteId, siteId),
        eq(nxStringOverrides.locale, locale),
        eq(nxStringOverrides.key, key),
      ),
    );
  clearStringOverrideCacheForSite(siteId);
}

/**
 * List every override row for a site (used by the admin UI
 * and by exporters). Returns the raw rows including null-
 * valued markers so the UI can show "this WAS overridden".
 */
export interface NxStringOverrideRow {
  siteId: string;
  locale: string;
  key: string;
  value: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export async function listStringOverridesForSite(
  siteId: string,
): Promise<NxStringOverrideRow[]> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(nxStringOverrides)
    .where(eq(nxStringOverrides.siteId, siteId))) as NxStringOverrideRow[];
  return rows;
}
