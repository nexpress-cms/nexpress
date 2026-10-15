import { sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "../jobs-contract/worker-subscription-contract.js";
import { NP_OPERATOR_SITE_JOB_QUEUES_V1 } from "./operator-observation.js";

type Db = ReturnType<typeof getDb>;
export type NpOperatorProgressScopeV1 = { kind: "site"; siteId: string } | { kind: "deployment" };
export interface NpOperatorProgressObservationV1 {
  schemaVersion: "np.operator-progress-observation.v1";
  source: "pg-boss";
  scope: NpOperatorProgressScopeV1;
  state: "observed" | "unsupported" | "unavailable";
  generatedAt: string;
  windowStart: string;
  windowSeconds: 900;
  coveredQueues: readonly string[];
  /** Completeness concerns retained matching rows, never deleted history or throughput. */
  complete: boolean;
  inspectedCount: number | null;
  started: number | null;
  completed: number | null;
  failed: number | null;
  cancelled: number | null;
}

/** Read actual retained transition timestamps. Absence of transitions never establishes a stuck worker. */
export async function npCollectOperatorProgressObservationV1(options: {
  scope: NpOperatorProgressScopeV1;
  maxTargets: number;
  db?: Db;
}): Promise<NpOperatorProgressObservationV1> {
  if (
    !options.scope ||
    (options.scope.kind !== "site" && options.scope.kind !== "deployment") ||
    (options.scope.kind === "site" && !npIsCanonicalSiteId(options.scope.siteId)) ||
    !Number.isSafeInteger(options.maxTargets) ||
    options.maxTargets < 1 ||
    options.maxTargets > 1000
  )
    throw new Error("Invalid Operator progress observation request.");
  const scope: NpOperatorProgressScopeV1 =
    options.scope.kind === "site"
      ? { kind: "site", siteId: options.scope.siteId }
      : { kind: "deployment" };
  const coveredQueues =
    scope.kind === "site" ? NP_OPERATOR_SITE_JOB_QUEUES_V1 : NP_AGENT_WORKER_QUEUE_NAMES;
  const now = Date.now();
  const unknown: NpOperatorProgressObservationV1 = {
    schemaVersion: "np.operator-progress-observation.v1",
    source: "pg-boss",
    scope,
    state: "unavailable",
    generatedAt: new Date(now).toISOString(),
    windowStart: new Date(now - 900_000).toISOString(),
    windowSeconds: 900,
    coveredQueues: [...coveredQueues],
    complete: false,
    inspectedCount: null,
    started: null,
    completed: null,
    failed: null,
    cancelled: null,
  };
  try {
    return await (options.db ?? getDb()).transaction(
      async (tx) => {
        const settings = await tx.execute(sql`select
          extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`);
        const milliseconds = Number(settings.rows[0]?.milliseconds);
        if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Invalid budget.");
        await tx.execute(
          sql`select set_config('statement_timeout', ${`${Math.min(500, milliseconds || 500)}ms`}, true)`,
        );
        const storage = await tx.execute(sql`select to_regclass('pgboss.job')::text as relation`);
        if (storage.rows[0]?.relation === null) return { ...unknown, state: "unsupported" };
        const attribution =
          scope.kind === "site"
            ? sql`and jsonb_typeof(data)='object' and jsonb_typeof(data->'siteId')='string'
                and data->>'siteId'=${scope.siteId}`
            : sql``;
        const facts = await tx.execute(sql`
          with candidates as materialized (
            select id, name, state, created_on, start_after, started_on, completed_on
            from pgboss.job
            where name in (${sql.join(
              coveredQueues.map((name) => sql`${name}`),
              sql`, `,
            )})
              ${attribution}
              and (started_on >= statement_timestamp()-interval '15 minutes'
                or completed_on >= statement_timestamp()-interval '15 minutes')
            order by greatest(started_on,completed_on) desc, id desc, name desc
            limit ${options.maxTargets + 1}
          ), inspected as (
            select * from candidates
            order by greatest(started_on,completed_on) desc, id desc, name desc
            limit ${options.maxTargets}
          )
          select statement_timestamp() as observed_at,
            statement_timestamp()-interval '15 minutes' as window_start,
            (select count(*) from candidates) > ${options.maxTargets} as truncated,
            count(*) as inspected_count,
            count(*) filter(where started_on >= statement_timestamp()-interval '15 minutes'
              and started_on <= statement_timestamp()) as started,
            count(*) filter(where state='completed' and completed_on >= statement_timestamp()-interval '15 minutes'
              and completed_on <= statement_timestamp()) as completed,
            count(*) filter(where state='failed' and completed_on >= statement_timestamp()-interval '15 minutes'
              and completed_on <= statement_timestamp()) as failed,
            count(*) filter(where state='cancelled' and completed_on >= statement_timestamp()-interval '15 minutes'
              and completed_on <= statement_timestamp()) as cancelled,
            count(*) filter(where state is null or state::text not in ('created','active','retry','completed','failed','cancelled')
              or created_on is null or not isfinite(created_on) or created_on > statement_timestamp()
              or start_after is null or not isfinite(start_after)
              or (started_on is not null and (not isfinite(started_on) or started_on < created_on
                or started_on > statement_timestamp()))
              or (completed_on is not null and (not isfinite(completed_on) or completed_on < created_on
                or completed_on > statement_timestamp() or (started_on is not null and completed_on < started_on)))
              or (state in ('completed','failed','cancelled') and completed_on is null)) as invalid
          from inspected`);
        const row = facts.rows[0];
        if (!row || Number(row.invalid) !== 0 || typeof row.truncated !== "boolean")
          throw new Error("Invalid retained transition evidence.");
        const clock = (value: unknown): string => {
          if (!(value instanceof Date) && typeof value !== "string")
            throw new Error("Invalid clock.");
          return new Date(value).toISOString();
        };
        const count = (key: string): number => {
          const value = Number(row[key]);
          if (!Number.isSafeInteger(value) || value < 0 || value > options.maxTargets)
            throw new Error("Invalid count.");
          return value;
        };
        return {
          ...unknown,
          state: "observed",
          generatedAt: clock(row.observed_at),
          windowStart: clock(row.window_start),
          complete: !row.truncated,
          inspectedCount: count("inspected_count"),
          started: count("started"),
          completed: count("completed"),
          failed: count("failed"),
          cancelled: count("cancelled"),
        };
      },
      { accessMode: "read only" },
    );
  } catch {
    // Missing/incompatible storage, invalid timestamps, permissions and timeout never become zero.
    return unknown;
  }
}
