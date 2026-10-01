import { sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";

type Db = ReturnType<typeof getDb>;

/** These framework payloads require siteId and their owning handlers resolve it. */
export const NP_OPERATOR_SITE_JOB_QUEUES_V1 = [
  "agent.changesetApply",
  "agent.changesetRollback",
  "agent.changesetVerify",
  "agent.eventDispatch",
  "agent.retentionPrune",
  "agent.runExecute",
  "content.afterDelete",
  "content.afterSave",
  "media.processImage",
  "plugin.scheduledTask",
] as const;

export interface NpOperatorJobsObservationV1 {
  schemaVersion: "np.operator-jobs-observation.v1";
  source: "pg-boss";
  state: "observed" | "unsupported" | "unavailable";
  siteId: string;
  generatedAt: string;
  windowStart: string;
  coveredQueues: readonly string[];
  /** Only retained rows with an explicit canonical matching payload.siteId. */
  attribution: "framework-site-payload";
  /** False also when unknown. This never attests global/custom/unattributed jobs. */
  complete: boolean;
  inspectedCount: number | null;
  created: number | null;
  active: number | null;
  retry: number | null;
  completed: number | null;
  failed: number | null;
  cancelled: number | null;
  oldestReadyAgeSeconds: number | null;
}

/**
 * Observe canonical pg-boss storage, without initializing an adapter or worker.
 * Counts describe the bounded newest retained cohort enqueued within 24 hours,
 * not throughput, all-time backlog, worker health or custom/global queues.
 * Hosts must explicitly select this source when they use canonical pg-boss.
 * Pass the existing root DB handle, not a parent transaction.
 */
export async function npCollectOperatorJobsObservationV1(options: {
  siteId: string;
  maxTargets: number;
  db?: Db;
}): Promise<NpOperatorJobsObservationV1> {
  if (!npIsCanonicalSiteId(options.siteId)) throw new Error("Invalid observation site.");
  if (
    !Number.isSafeInteger(options.maxTargets) ||
    options.maxTargets < 1 ||
    options.maxTargets > 1000
  )
    throw new Error("Invalid observation bound.");
  const now = Date.now();
  const unknown: NpOperatorJobsObservationV1 = {
    schemaVersion: "np.operator-jobs-observation.v1",
    source: "pg-boss",
    state: "unavailable",
    siteId: options.siteId,
    generatedAt: new Date(now).toISOString(),
    windowStart: new Date(now - 86_400_000).toISOString(),
    coveredQueues: [...NP_OPERATOR_SITE_JOB_QUEUES_V1],
    attribution: "framework-site-payload",
    complete: false,
    inspectedCount: null,
    created: null,
    active: null,
    retry: null,
    completed: null,
    failed: null,
    cancelled: null,
    oldestReadyAgeSeconds: null,
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
        const facts = await tx.execute(sql`
        with candidates as materialized (
          select id, name, state, start_after, started_on, created_on
          from pgboss.job
          where name in (${sql.join(
            NP_OPERATOR_SITE_JOB_QUEUES_V1.map((name) => sql`${name}`),
            sql`, `,
          )})
            and jsonb_typeof(data)='object' and jsonb_typeof(data->'siteId')='string'
            and data->>'siteId'=${options.siteId}
            and created_on >= statement_timestamp()-interval '24 hours'
            and created_on <= statement_timestamp()
          order by created_on desc, id desc, name desc limit ${options.maxTargets + 1}
        ), inspected as (
          select * from candidates order by created_on desc, id desc, name desc limit ${options.maxTargets}
        )
        select statement_timestamp() as observed_at,
          statement_timestamp()-interval '24 hours' as window_start,
          (select count(*) from candidates) > ${options.maxTargets} as truncated,
          count(*) as inspected_count,
          count(*) filter(where state='created') as created,
          count(*) filter(where state='active') as active,
          count(*) filter(where state='retry') as retry,
          count(*) filter(where state='completed') as completed,
          count(*) filter(where state='failed') as failed,
          count(*) filter(where state='cancelled') as cancelled,
          floor(extract(epoch from statement_timestamp()-min(start_after)
            filter(where state in ('created','retry') and start_after <= statement_timestamp()))) as ready_age,
          count(*) filter(where state is null or state::text not in ('created','active','retry','completed','failed','cancelled')
            or start_after is null or not isfinite(start_after)
            or (state='active' and (started_on is null or not isfinite(started_on) or started_on > statement_timestamp()))) as invalid
        from inspected`);
        const row = facts.rows[0];
        if (!row || Number(row.invalid) !== 0 || typeof row.truncated !== "boolean")
          throw new Error("Invalid retained facts.");
        const clock = (value: unknown): string => {
          if (!(value instanceof Date) && typeof value !== "string")
            throw new Error("Invalid clock.");
          return new Date(value).toISOString();
        };
        const count = (key: string): number => {
          const value = Number(row[key]);
          if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid count.");
          return value;
        };
        return {
          ...unknown,
          state: "observed",
          generatedAt: clock(row.observed_at),
          windowStart: clock(row.window_start),
          complete: !row.truncated,
          inspectedCount: count("inspected_count"),
          created: count("created"),
          active: count("active"),
          retry: count("retry"),
          completed: count("completed"),
          failed: count("failed"),
          cancelled: count("cancelled"),
          oldestReadyAgeSeconds: row.ready_age === null ? null : count("ready_age"),
        };
      },
      { accessMode: "read only" },
    );
  } catch {
    // Timeouts, permissions, schema drift and invalid facts never become zero.
    return unknown;
  }
}
