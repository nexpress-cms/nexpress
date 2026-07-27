import {
  NP_COMMUNITY_REALTIME_RETENTION_MS,
  type NpCommunityRealtimeOutboxStats,
} from "@nexpress/core/community";

import {
  evaluateCommunityRealtimeHealth,
  type CommunityRealtimeHealthCheck,
} from "../lib/community-realtime-health.js";

type CommunityRealtimeEnv = Record<string, string | undefined>;

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

function skipped(detail: string, hint?: string): CommunityRealtimeHealthCheck {
  return {
    id: "community.realtime_retention",
    label: "Community realtime retention",
    state: "warn",
    detail,
    ...(hint ? { hint } : {}),
  };
}

function parseCount(value: unknown, path: string): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${path} must be a non-negative integer string.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${path} exceeds the safe integer range.`);
  return parsed;
}

/** Inspect realtime retention without bootstrapping Core, for Doctor and local ops. */
export async function checkCommunityRealtimeRetention(
  env: CommunityRealtimeEnv,
): Promise<CommunityRealtimeHealthCheck> {
  const url = env.DATABASE_URL;
  if (!url) return skipped("skipped (no DATABASE_URL)");

  let pg: PgModuleLike;
  try {
    pg = (await import("pg")) as unknown as PgModuleLike;
  } catch {
    return skipped("skipped (no `pg`)");
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const relation = await client.query<{
      tableName: string | null;
      liveJobs: string | null;
      archivedJobs: string | null;
    }>(
      `select to_regclass('public.np_community_realtime_events')::text as "tableName",
              to_regclass('pgboss.job')::text as "liveJobs",
              to_regclass('pgboss.archive')::text as "archivedJobs"`,
    );
    if (!relation.rows[0]?.tableName) {
      await client.end();
      return skipped(
        "skipped (np_community_realtime_events has not been migrated)",
        "Run `pnpm db:migrate` before accepting community traffic.",
      );
    }

    const now = new Date();
    const cutoff = new Date(now.getTime() - NP_COMMUNITY_REALTIME_RETENTION_MS);
    const result = await client.query<{
      totalRows: unknown;
      expiredRows: unknown;
      oldestCreatedAt: Date | null;
    }>(
      `select count(*)::text as "totalRows",
              count(*) filter (where created_at < $1::timestamptz)::text as "expiredRows",
              min(created_at) as "oldestCreatedAt"
         from np_community_realtime_events`,
      [cutoff.toISOString()],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Community realtime retention query returned no row.");
    const stats: NpCommunityRealtimeOutboxStats = {
      totalRows: parseCount(row.totalRows, "community.realtime.totalRows"),
      expiredRows: parseCount(row.expiredRows, "community.realtime.expiredRows"),
      oldestCreatedAt: row.oldestCreatedAt,
      cutoff,
    };
    let recentCleanupFailures = 0;
    const failureSince = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
    for (const table of [
      ...(relation.rows[0]?.liveJobs ? ["job"] : []),
      ...(relation.rows[0]?.archivedJobs ? ["archive"] : []),
    ]) {
      const failures = await client.query<{ total: unknown }>(
        `select count(*)::text as total
           from pgboss.${table}
          where name = 'system.communityRealtimePrune'
            and state::text = any($1::text[])
            and created_on >= $2::timestamptz`,
        [["failed", "expired", "retry"], failureSince],
      );
      recentCleanupFailures += parseCount(
        failures.rows[0]?.total,
        `community.realtime.${table}Failures`,
      );
      if (!Number.isSafeInteger(recentCleanupFailures)) {
        throw new Error("community.realtime.recentCleanupFailures exceeds the safe integer range.");
      }
    }
    const check = evaluateCommunityRealtimeHealth(stats, recentCleanupFailures);
    await client.end();
    return check;
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return skipped(
      `could not inspect realtime retention: ${error instanceof Error ? error.message : String(error)}`,
      "Verify Postgres and the community migration, then rerun the diagnostic.",
    );
  }
}
