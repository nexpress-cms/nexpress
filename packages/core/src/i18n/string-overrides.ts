import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npStringOverrides } from "../db/schema/system.js";
import {
  npCreateStringOverrideCatalog,
  npRequireLocale,
  npRequireStringOverrideDeleteQuery,
  npRequireStringOverrideMutation,
  npRequireStringOverrideRow,
  npRequireTranslationKey,
} from "../i18n-contract/contract.js";
import type { NpStringOverrideCatalog, NpStringOverrideRow } from "../i18n-contract/types.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID, npIsCanonicalSiteId } from "../sites/id-contract.js";
import { getI18nConfig } from "./registry.js";

/**
 * Per-site UI string overrides. Persisted rows and public cache snapshots pass
 * the same exact i18n contract; no mutable Map or DB-owned Date escapes.
 */
const OVERRIDE_CACHE_TTL_MS = 30_000;
const OVERRIDE_SITE_CACHE_LIMIT = 1_000;
const cacheBySite = new Map<
  string,
  { readonly catalog: NpStringOverrideCatalog; readonly expiresAt: number }
>();
const loadBySite = new Map<string, Promise<NpStringOverrideCatalog>>();
const generationBySite = new Map<string, number>();

function requireSiteId(value: unknown): string {
  if (!npIsCanonicalSiteId(value)) throw new TypeError("String override siteId is invalid.");
  return value;
}

function generation(siteId: string): number {
  return generationBySite.get(siteId) ?? 0;
}

function cachedCatalog(siteId: string): NpStringOverrideCatalog | undefined {
  const entry = cacheBySite.get(siteId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cacheBySite.delete(siteId);
    return undefined;
  }
  return entry.catalog;
}

function cacheCatalog(siteId: string, catalog: NpStringOverrideCatalog): void {
  for (const [cachedSiteId, entry] of cacheBySite) {
    if (entry.expiresAt <= Date.now()) cacheBySite.delete(cachedSiteId);
  }
  cacheBySite.delete(siteId);
  cacheBySite.set(siteId, {
    catalog,
    expiresAt: Date.now() + OVERRIDE_CACHE_TTL_MS,
  });
  while (cacheBySite.size > OVERRIDE_SITE_CACHE_LIMIT) {
    const oldest = cacheBySite.keys().next().value;
    if (oldest === undefined) break;
    cacheBySite.delete(oldest);
  }
}

async function queryStringOverrides(siteId: string): Promise<NpStringOverrideRow[]> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(npStringOverrides)
    .where(eq(npStringOverrides.siteId, siteId))) as unknown[];
  const config = getI18nConfig() ?? { locales: ["en"], defaultLocale: "en" };
  return rows.map((row) => npRequireStringOverrideRow(row, { config }));
}

/** Force a fresh validated read. An invalidation racing this query wins. */
export async function loadStringOverridesForSite(
  siteIdValue: string,
): Promise<NpStringOverrideCatalog> {
  const siteId = requireSiteId(siteIdValue);
  const startedAtGeneration = generation(siteId);
  const pending = (async (): Promise<NpStringOverrideCatalog> => {
    const rows = await queryStringOverrides(siteId);
    const catalog = npCreateStringOverrideCatalog(rows);
    if (generation(siteId) !== startedAtGeneration) {
      return loadStringOverridesForSite(siteId);
    }
    cacheCatalog(siteId, catalog);
    return catalog;
  })();
  loadBySite.set(siteId, pending);
  try {
    return await pending;
  } finally {
    if (loadBySite.get(siteId) === pending) {
      loadBySite.delete(siteId);
      generationBySite.delete(siteId);
    }
  }
}

/** Get an immutable snapshot, de-duplicating concurrent cold-cache reads. */
export async function getStringOverridesForSite(
  siteIdValue: string,
): Promise<NpStringOverrideCatalog> {
  const siteId = requireSiteId(siteIdValue);
  const cached = cachedCatalog(siteId);
  if (cached) return cached;
  const pending = loadBySite.get(siteId) ?? loadStringOverridesForSite(siteId);
  const result = await pending;
  return cachedCatalog(siteId) ?? result;
}

export function clearStringOverrideCacheForSite(siteIdValue: string): void {
  const siteId = requireSiteId(siteIdValue);
  if (loadBySite.has(siteId)) generationBySite.set(siteId, generation(siteId) + 1);
  else generationBySite.delete(siteId);
  cacheBySite.delete(siteId);
}

/** Tests use this between cases. Production never wipes globally. */
export function resetStringOverrideCache(): void {
  cacheBySite.clear();
  loadBySite.clear();
  generationBySite.clear();
}

export function getStringOverride(
  siteIdValue: string,
  localeValue: string,
  keyValue: string,
): string | null {
  const siteId = requireSiteId(siteIdValue);
  const locale = npRequireLocale(localeValue);
  const key = npRequireTranslationKey(keyValue);
  return cachedCatalog(siteId)?.[locale]?.[key] ?? null;
}

export async function setStringOverride(
  localeValue: string,
  keyValue: string,
  value: string | null,
  options?: { readonly siteId?: string; readonly updatedBy?: string | null },
): Promise<void> {
  const mutation = npRequireStringOverrideMutation({
    locale: localeValue,
    key: keyValue,
    value,
  });
  const siteId = requireSiteId(options?.siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID);
  const now = new Date();
  const row = npRequireStringOverrideRow(
    {
      siteId,
      ...mutation,
      updatedAt: now,
      updatedBy: options?.updatedBy ?? null,
    },
    { config: getI18nConfig() ?? { locales: ["en"], defaultLocale: "en" } },
  );
  const db = getDb();
  await db
    .insert(npStringOverrides)
    .values(row)
    .onConflictDoUpdate({
      target: [npStringOverrides.siteId, npStringOverrides.locale, npStringOverrides.key],
      set: {
        value: row.value,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      },
    });
  clearStringOverrideCacheForSite(siteId);
}

export async function deleteStringOverride(
  localeValue: string,
  keyValue: string,
  options?: { readonly siteId?: string },
): Promise<void> {
  const query = npRequireStringOverrideDeleteQuery({ locale: localeValue, key: keyValue });
  const siteId = requireSiteId(options?.siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID);
  const db = getDb();
  await db
    .delete(npStringOverrides)
    .where(
      and(
        eq(npStringOverrides.siteId, siteId),
        eq(npStringOverrides.locale, query.locale),
        eq(npStringOverrides.key, query.key),
      ),
    );
  clearStringOverrideCacheForSite(siteId);
}

export async function listStringOverridesForSite(
  siteIdValue: string,
): Promise<readonly NpStringOverrideRow[]> {
  const rows = await queryStringOverrides(requireSiteId(siteIdValue));
  return Object.freeze(rows);
}
