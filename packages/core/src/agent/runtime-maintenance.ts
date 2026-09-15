import { sql } from "drizzle-orm";
import { npWithAgentRuntimeRetentionBudgetV1 } from "./runtime-retention-budget.js";
import { npPruneAgentRuntimeRetentionV1 } from "./runtime-retention.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { getDb } from "../db/runtime.js";

function invalid(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_MAINTENANCE_INVALID",
    400,
    "Agent maintenance is unavailable.",
  );
}
function input(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !keys.includes(key) ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    )
      return invalid();
  }
  const record = value as Record<string, unknown>;
  if (!npIsCanonicalSiteId(record.siteId)) return invalid();
  return record;
}
function clock(value: unknown): Date {
  if (value === undefined) return new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return invalid();
  return new Date(value.getTime());
}
function count(value: unknown): number {
  const result = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) return invalid();
  return result;
}
function age(value: unknown, now: Date): number | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.getTime() > now.getTime()) return invalid();
  return Math.floor((now.getTime() - date.getTime()) / 1000);
}

/** Host-only Runtime retention; the legacy name and UUID cursor remain job-compatible. */
export async function pruneAgentRuntimeEventsV1(options: {
  siteId: string;
  cursor?: string | null;
  limit?: number;
  now?: Date;
}): Promise<{ examined: number; pruned: number; nextCursor: string | null }> {
  const args = input(options, ["siteId", "cursor", "limit", "now"]);
  const now = clock(args.now);
  const limit = args.limit === undefined ? 50 : args.limit;
  const cursor = args.cursor === undefined ? null : args.cursor;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor !== null &&
      (typeof cursor !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(cursor)))
  )
    return invalid();
  npAssertAgentPreviewEffectsAllowed();
  return npWithAgentRuntimeRetentionBudgetV1((db, beforeStatement) =>
    npWithAgentRuntimeControlTransactionV1(
      options.siteId,
      ({ db, settings, revision }) =>
        npPruneAgentRuntimeRetentionV1({
          db,
          siteId: options.siteId,
          cursor,
          limit,
          now,
          settings,
          revision,
          beforeStatement,
        }),
      db,
    ),
  );
}

/** Internal aggregate evidence only; no row ids, payloads or provider/worker readiness are invented. */
export async function collectAgentRuntimeMaintenanceV1(
  options: { siteId: string; now?: Date },
  db?: ReturnType<typeof getDb>,
) {
  const args = input(options, ["siteId", "now"]);
  const now = clock(args.now);
  return npWithAgentRuntimeControlTransactionV1(
    options.siteId,
    async ({ db, settings }) => {
      const events = await db.execute(sql`select count(*) as total,
      count(*) filter(where dispatched_at is null) as pending,
      count(*) filter(where expires_at<=${now}) as expired,
      count(*) filter(where expires_at<=${now} and dispatched_at is null) as expired_pending,
      min(recorded_at) filter(where dispatched_at is null) as oldest
      from np_agent_events where site_id=${options.siteId}`);
      const triggers = await db.execute(sql`select count(*) as total,
      count(*) filter(where enabled) as enabled,
      count(*) filter(where enabled and kind='schedule' and next_run_at<=${now}) as due,
      min(next_run_at) filter(where enabled and kind='schedule' and next_run_at<=${now}) as oldest
      from np_agent_triggers where site_id=${options.siteId}`);
      const runs = await db.execute(sql`select count(*) as total,
      count(*) filter(where state in ('queued','running','waiting_retry','waiting_approval','verifying')) as active,
      count(*) filter(where state='queued') as queued,
      count(*) filter(where state='waiting_approval') as waiting_approval,
      min(queued_at) filter(where state='queued') as oldest
      from np_agent_runs where site_id=${options.siteId} and origin='runtime'`);
      const e = events.rows[0],
        t = triggers.rows[0],
        r = runs.rows[0];
      if (!e || !t || !r) return invalid();
      return {
        runtime: {
          enabled: settings.enabled,
          paused: settings.emergencyPause.paused,
          total: count(r.total),
          active: count(r.active),
          queued: count(r.queued),
          waitingApproval: count(r.waiting_approval),
          oldestQueuedAgeSeconds: age(r.oldest, now),
        },
        events: {
          total: count(e.total),
          pending: count(e.pending),
          expired: count(e.expired),
          expiredPending: count(e.expired_pending),
          oldestPendingAgeSeconds: age(e.oldest, now),
        },
        triggers: {
          total: count(t.total),
          enabled: count(t.enabled),
          due: count(t.due),
          oldestDueAgeSeconds: age(t.oldest, now),
        },
      };
    },
    db,
  );
}
