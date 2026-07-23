import {
  npIsCanonicalSiteId,
  npNormalizeSiteQuotas,
  type NpSiteQuotas,
} from "@nexpress/core/settings";
import { NP_SITE_JOB_QUOTA_WINDOW_MS } from "@nexpress/core/sites";

import {
  npIsCanonicalCollectionMainTableName,
  npIsCollectionMainTableName,
} from "./doctor-collection-contract.js";
import type { CheckResult } from "./doctor-readiness.js";

type QuotaEnv = Record<string, string | undefined>;

interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  default: {
    Client: new (config: {
      connectionString: string;
      connectionTimeoutMillis?: number;
    }) => PgClientLike;
  };
}

interface QuotaSettingRow {
  siteId: unknown;
  value: unknown;
}

interface SiteQuotaObservation {
  siteId: string;
  limits: NpSiteQuotas;
  storageBytes: number;
  documents: number;
  jobEnqueuesLastHour: number | null;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  const normalized = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || (normalized as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return normalized as number;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function selectSiteQuotaDocumentTables(tableNames: readonly string[]): string[] {
  const tables = tableNames.filter(npIsCollectionMainTableName);
  const invalidTable = tables.find((table) => !npIsCanonicalCollectionMainTableName(table));
  if (invalidTable) throw new Error(`Unsafe collection table name '${invalidTable}'.`);
  return tables;
}

async function countDocuments(
  client: PgClientLike,
  siteId: string,
  tables: readonly string[],
): Promise<number> {
  let total = 0;
  for (const table of tables) {
    const result = await client.query<{ total: unknown }>(
      `select count(*)::text as total from ${quoteIdentifier(table)} where site_id = $1`,
      [siteId],
    );
    total += nonNegativeSafeInteger(result.rows[0]?.total ?? 0, `${table}.documents`);
    if (!Number.isSafeInteger(total)) {
      throw new Error("Site document usage exceeds the safe integer range.");
    }
  }
  return total;
}

async function countStorageBytes(client: PgClientLike, siteId: string): Promise<number> {
  const result = await client.query<{ total: unknown }>(
    `select coalesce(sum(
              filesize + coalesce((
                select sum((variant.value ->> 'filesize')::bigint)
                  from jsonb_each(coalesce(sizes, '{}'::jsonb)) as variant
              ), 0)
            ), 0)::text as total
       from np_media
      where site_id = $1`,
    [siteId],
  );
  return nonNegativeSafeInteger(result.rows[0]?.total ?? 0, "np_media.storageBytes");
}

async function countBuiltInSiteJobs(
  client: PgClientLike,
  siteId: string,
  since: Date,
): Promise<number | null> {
  const relations = await client.query<{ live: string | null; archive: string | null }>(
    `select to_regclass('pgboss.job')::text as live,
            to_regclass('pgboss.archive')::text as archive`,
  );
  if (!relations.rows[0]?.live || !relations.rows[0].archive) return null;
  const tables = ["pgboss.job", "pgboss.archive"];
  const union = tables
    .map((table) => `select name, data, created_on from ${table}`)
    .join(" union all ");
  const result = await client.query<{ total: unknown }>(
    `select count(*)::text as total
       from (${union}) jobs
      where data->>'siteId' = $1
        and created_on >= $2
        and name = 'plugin.scheduledTask'`,
    [siteId, since.toISOString()],
  );
  return nonNegativeSafeInteger(result.rows[0]?.total ?? 0, "pgboss.siteJobEnqueues");
}

function atOrOverLimit(usage: number, limit: number | null): boolean {
  return limit !== null && usage >= limit;
}

export function evaluateSiteQuotaObservations(
  observations: readonly SiteQuotaObservation[],
): CheckResult {
  const unavailable = observations.filter(
    (entry) => entry.limits.jobEnqueuesPerHour !== null && entry.jobEnqueuesLastHour === null,
  );
  const atCapacity = observations.filter(
    (entry) =>
      atOrOverLimit(entry.storageBytes, entry.limits.storageBytes) ||
      atOrOverLimit(entry.documents, entry.limits.documents) ||
      (entry.jobEnqueuesLastHour !== null &&
        atOrOverLimit(entry.jobEnqueuesLastHour, entry.limits.jobEnqueuesPerHour)),
  );
  if (unavailable.length > 0) {
    return {
      id: "sites.quotas",
      state: "error",
      label: "Site resource quotas",
      detail: `${unavailable.length.toString()} site(s) require exact job history, but pg-boss history is unavailable`,
      hint: "Enable the pg-boss producer and verify its job/archive tables before enforcing a site job quota.",
    };
  }
  if (atCapacity.length > 0) {
    return {
      id: "sites.quotas",
      state: "warn",
      label: "Site resource quotas",
      detail: `${atCapacity.length.toString()} of ${observations.length.toString()} configured site(s) are at or over a resource limit: ${atCapacity.map((entry) => entry.siteId).join(", ")}`,
      hint: "Review usage in Admin > Sites > Quotas, reclaim resources, or raise the affected limit.",
    };
  }
  return {
    id: "sites.quotas",
    state: "ok",
    label: "Site resource quotas",
    detail:
      observations.length === 0
        ? "all sites use unlimited defaults"
        : `${observations.length.toString()} configured site quota row(s) have available headroom`,
  };
}

/** Inspect persisted tenant limits without bootstrapping the application runtime. */
export async function checkSiteQuotaUsage(env: QuotaEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "sites.quotas",
      state: "warn",
      label: "Site resource quotas",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await import("pg")) as unknown as PgModuleLike;
  } catch {
    return {
      id: "sites.quotas",
      state: "warn",
      label: "Site resource quotas",
      detail: "skipped (no `pg`)",
    };
  }
  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const [settings, collectionTables] = await Promise.all([
      client.query<QuotaSettingRow>(
        `select site_id as "siteId", value
           from np_settings
          where key = 'site.quotas'
          order by site_id`,
      ),
      client.query<{ tableName: string }>(
        `select tablename as "tableName"
           from pg_catalog.pg_tables
          where schemaname = current_schema()
            and tablename like 'np_c_%'
          order by tablename`,
      ),
    ]);
    const tables = selectSiteQuotaDocumentTables(collectionTables.rows.map((row) => row.tableName));
    const since = new Date(Date.now() - NP_SITE_JOB_QUOTA_WINDOW_MS);
    const observations: SiteQuotaObservation[] = [];
    for (const row of settings.rows) {
      if (!npIsCanonicalSiteId(row.siteId)) {
        throw new Error(`Quota setting references invalid site id '${String(row.siteId)}'.`);
      }
      const limits = npNormalizeSiteQuotas(row.value);
      const [storageBytes, documents, jobEnqueuesLastHour] = await Promise.all([
        countStorageBytes(client, row.siteId),
        countDocuments(client, row.siteId, tables),
        limits.jobEnqueuesPerHour === null
          ? Promise.resolve(null)
          : countBuiltInSiteJobs(client, row.siteId, since),
      ]);
      observations.push({
        siteId: row.siteId,
        limits,
        storageBytes,
        documents,
        jobEnqueuesLastHour,
      });
    }
    await client.end();
    return evaluateSiteQuotaObservations(observations);
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "sites.quotas",
      state: "error",
      label: "Site resource quotas",
      detail: `could not inspect quota usage: ${error instanceof Error ? error.message : String(error)}`,
      hint: "Repair malformed quota, media, collection, or pg-boss history rows before relying on enforcement.",
    };
  }
}
