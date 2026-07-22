import { count, eq, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { getAllCollectionSlugs, getCollectionTable } from "../collections/registry.js";
import { getDb } from "../db/runtime.js";
import { npMedia } from "../db/schema/media.js";
import { npSettings, npSites } from "../db/schema/system.js";
import { NpNotFoundError, NpRateLimitError, NpServiceUnavailableError } from "../errors.js";
import {
  DEFAULT_SITE_QUOTAS,
  npAssertSiteQuotaSnapshot,
  npNormalizeSiteQuotas,
} from "../settings/contract.js";
import type {
  NpSiteQuotaMetric,
  NpSiteQuotaSnapshot,
  NpSiteQuotaUsage,
  NpSiteQuotas,
} from "../settings/types.js";
import { getCurrentSiteId } from "./context.js";
import { NP_DEFAULT_SITE_ID, npIsCanonicalSiteId } from "./id-contract.js";

export const NP_SITE_QUOTA_SETTING_KEY = "site.quotas";
export const NP_SITE_JOB_QUOTA_WINDOW_MS = 60 * 60 * 1000;

type QueryCondition = SQL | ReturnType<typeof eq>;

interface SelectQuery extends Promise<unknown[]> {
  where(condition: QueryCondition): SelectQuery;
  limit(limit: number): SelectQuery;
}

export interface NpSiteQuotaDb {
  execute(query: SQL): Promise<unknown>;
  select(selection?: Record<string, unknown>): {
    from(table: PgTable): SelectQuery;
  };
  insert(table: PgTable): {
    values(values: Record<string, unknown>): {
      onConflictDoUpdate(options: {
        target: unknown[];
        set: Record<string, unknown>;
      }): Promise<unknown>;
    };
  };
}

interface NpSiteQuotaDatabase extends NpSiteQuotaDb {
  transaction<T>(callback: (tx: NpSiteQuotaDb) => Promise<T>): Promise<T>;
}

export type NpSiteJobUsageReader = (siteId: string, since: Date) => Promise<number>;

async function resolveSiteId(siteId?: string): Promise<string> {
  const resolved = siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  if (!npIsCanonicalSiteId(resolved)) throw new NpNotFoundError("site", resolved);
  return resolved;
}

function requireNonNegativeSafeInteger(value: unknown, path: string): number {
  const normalized = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || (normalized as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return normalized as number;
}

async function requireSite(db: NpSiteQuotaDb, siteId: string): Promise<void> {
  const [site] = (await db
    .select({ id: npSites.id })
    .from(npSites)
    .where(eq(npSites.id, siteId))
    .limit(1)) as Array<{ id: string }>;
  if (!site) throw new NpNotFoundError("site", siteId);
}

async function getSiteQuotasWithDb(db: NpSiteQuotaDb, siteId: string): Promise<NpSiteQuotas> {
  const [row] = (await db
    .select({ value: npSettings.value })
    .from(npSettings)
    .where(
      sql`${npSettings.siteId} = ${siteId} and ${npSettings.key} = ${NP_SITE_QUOTA_SETTING_KEY}`,
    )
    .limit(1)) as Array<{ value: unknown }>;
  return row ? npNormalizeSiteQuotas(row.value) : { ...DEFAULT_SITE_QUOTAS };
}

/** Serialize every quota-sensitive mutation for one tenant. */
export async function npLockSiteQuotas(db: NpSiteQuotaDb, siteId: string): Promise<void> {
  if (!npIsCanonicalSiteId(siteId)) {
    throw new Error("Site quota lock requires a canonical site id.");
  }
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:site-quota:${siteId}`}, 0))`,
  );
}

export async function getSiteQuotas(siteId?: string): Promise<NpSiteQuotas> {
  const resolved = await resolveSiteId(siteId);
  const db = getDb() as unknown as NpSiteQuotaDb;
  await requireSite(db, resolved);
  return getSiteQuotasWithDb(db, resolved);
}

export async function setSiteQuotas(
  value: unknown,
  updatedBy: string | null,
  siteId?: string,
): Promise<NpSiteQuotas> {
  const normalized = npNormalizeSiteQuotas(value);
  const resolved = await resolveSiteId(siteId);
  const db = getDb() as unknown as NpSiteQuotaDatabase;
  await db.transaction(async (tx) => {
    await npLockSiteQuotas(tx, resolved);
    await requireSite(tx, resolved);
    const updatedAt = new Date();
    await tx
      .insert(npSettings)
      .values({
        siteId: resolved,
        key: NP_SITE_QUOTA_SETTING_KEY,
        value: normalized,
        updatedAt,
        updatedBy,
      })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value: normalized, updatedAt, updatedBy },
      });
  });
  return normalized;
}

function getQuotaCollectionTables(): Array<{ table: PgTable; siteId: unknown }> {
  return getAllCollectionSlugs().map((slug) => {
    const table = getCollectionTable(slug) as PgTable;
    const siteId = (table as unknown as Record<string, unknown>).siteId;
    if (!siteId) throw new Error(`Registered collection "${slug}" has no siteId column.`);
    return { table, siteId };
  });
}

async function countSiteDocuments(db: NpSiteQuotaDb, siteId: string): Promise<number> {
  let documents = 0;
  for (const { table, siteId: siteIdColumn } of getQuotaCollectionTables()) {
    const [row] = (await db
      .select({ value: count() })
      .from(table)
      .where(eq(siteIdColumn as never, siteId))) as Array<{ value: unknown }>;
    documents += requireNonNegativeSafeInteger(row?.value ?? 0, "siteQuota.documents");
    if (!Number.isSafeInteger(documents)) {
      throw new Error("siteQuota.documents exceeds the safe integer range.");
    }
  }
  return documents;
}

async function countSiteStorageBytes(db: NpSiteQuotaDb, siteId: string): Promise<number> {
  const [row] = (await db
    .select({
      value: sql<number>`coalesce(sum(
        ${npMedia.filesize} + coalesce((
          select sum((variant.value ->> 'filesize')::bigint)
            from jsonb_each(coalesce(${npMedia.sizes}, '{}'::jsonb)) as variant
        ), 0)
      ), 0)::text`,
    })
    .from(npMedia)
    .where(eq(npMedia.siteId, siteId))) as Array<{ value: unknown }>;
  return requireNonNegativeSafeInteger(row?.value ?? 0, "siteQuota.storageBytes");
}

export async function getSiteQuotaUsage(
  siteId?: string,
  readJobUsage?: NpSiteJobUsageReader,
): Promise<NpSiteQuotaUsage> {
  const resolved = await resolveSiteId(siteId);
  const db = getDb() as unknown as NpSiteQuotaDb;
  await requireSite(db, resolved);
  const [storageBytes, documents, rawJobEnqueuesLastHour] = await Promise.all([
    countSiteStorageBytes(db, resolved),
    countSiteDocuments(db, resolved),
    readJobUsage
      ? readJobUsage(resolved, new Date(Date.now() - NP_SITE_JOB_QUOTA_WINDOW_MS))
      : Promise.resolve(null),
  ]);
  const jobEnqueuesLastHour =
    rawJobEnqueuesLastHour === null
      ? null
      : requireNonNegativeSafeInteger(rawJobEnqueuesLastHour, "siteQuota.jobEnqueuesLastHour");
  return { storageBytes, documents, jobEnqueuesLastHour };
}

export async function getSiteQuotaSnapshot(
  siteId?: string,
  readJobUsage?: NpSiteJobUsageReader,
): Promise<NpSiteQuotaSnapshot> {
  const resolved = await resolveSiteId(siteId);
  const [limits, usage] = await Promise.all([
    getSiteQuotas(resolved),
    getSiteQuotaUsage(resolved, readJobUsage),
  ]);
  const exceeded: NpSiteQuotaMetric[] = [];
  if (limits.storageBytes !== null && usage.storageBytes > limits.storageBytes) {
    exceeded.push("storageBytes");
  }
  if (limits.documents !== null && usage.documents > limits.documents) {
    exceeded.push("documents");
  }
  if (
    limits.jobEnqueuesPerHour !== null &&
    usage.jobEnqueuesLastHour !== null &&
    usage.jobEnqueuesLastHour > limits.jobEnqueuesPerHour
  ) {
    exceeded.push("jobEnqueuesPerHour");
  }
  const unavailable: NpSiteQuotaMetric[] =
    limits.jobEnqueuesPerHour !== null && usage.jobEnqueuesLastHour === null
      ? ["jobEnqueuesPerHour"]
      : [];
  const snapshot = { limits, usage, exceeded, unavailable };
  npAssertSiteQuotaSnapshot(snapshot);
  return snapshot;
}

export async function npAssertSiteStorageQuotaDelta(
  db: NpSiteQuotaDb,
  siteId: string,
  additionalBytes: number,
): Promise<void> {
  if (!Number.isSafeInteger(additionalBytes)) {
    throw new Error("Site storage quota delta must be a safe integer.");
  }
  const quotas = await getSiteQuotasWithDb(db, siteId);
  if (quotas.storageBytes === null || additionalBytes <= 0) return;
  const used = await countSiteStorageBytes(db, siteId);
  const next = used + additionalBytes;
  if (!Number.isSafeInteger(next) || next > quotas.storageBytes) {
    throw new NpRateLimitError(
      `Site storage quota exceeded — ${used.toString()} of ${quotas.storageBytes.toString()} bytes are already reserved.`,
    );
  }
}

export async function npAssertSiteDocumentCreateQuota(
  db: NpSiteQuotaDb,
  siteId: string,
): Promise<void> {
  const quotas = await getSiteQuotasWithDb(db, siteId);
  if (quotas.documents === null) return;
  const used = await countSiteDocuments(db, siteId);
  if (used >= quotas.documents) {
    throw new NpRateLimitError(
      `Site document quota exceeded — ${used.toString()} of ${quotas.documents.toString()} documents are in use.`,
    );
  }
}

export async function npWithSiteJobEnqueueQuota<T>(
  siteId: string,
  readJobUsage: NpSiteJobUsageReader | undefined,
  enqueue: () => Promise<T>,
): Promise<T> {
  const db = getDb() as unknown as NpSiteQuotaDatabase;
  return db.transaction(async (tx) => {
    await npLockSiteQuotas(tx, siteId);
    const quotas = await getSiteQuotasWithDb(tx, siteId);
    if (quotas.jobEnqueuesPerHour === null) return enqueue();
    if (!readJobUsage) {
      throw new NpServiceUnavailableError(
        "The active job queue cannot measure exact site enqueue history required by this quota.",
      );
    }
    const since = new Date(Date.now() - NP_SITE_JOB_QUOTA_WINDOW_MS);
    const used = requireNonNegativeSafeInteger(
      await readJobUsage(siteId, since),
      "siteQuota.jobEnqueuesLastHour",
    );
    if (used >= quotas.jobEnqueuesPerHour) {
      throw new NpRateLimitError(
        `Site job enqueue quota exceeded — ${used.toString()} of ${quotas.jobEnqueuesPerHour.toString()} jobs were admitted in the last hour.`,
      );
    }
    return enqueue();
  });
}
