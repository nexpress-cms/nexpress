import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { desc, eq, gt, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { readEnvPositiveInt } from "../config/env.js";
import { npWorkerHeartbeats } from "../db/schema/system.js";
import { getLogger } from "../observability/logger.js";

/**
 * Phase 19 — worker liveness signal.
 *
 * The worker process upserts its row every
 * `WORKER_HEARTBEAT_INTERVAL_MS` so admins can tell whether the
 * pg-boss queue actually has a draining process attached.
 * Without this the only signal was "Pending stays high while
 * Completed doesn't grow," which a stuck DB or a stopped
 * worker look identical from outside.
 *
 * Stale rows (no heartbeat in `WORKER_STALE_THRESHOLD_MS`) are
 * reported `unhealthy`; the row stays in place until an
 * operator GCs it or a worker with the same id rejoins. The
 * id is `hostname:pid` so a restarted process on the same host
 * naturally reclaims its row instead of stacking duplicates.
 */

/**
 * How often a running worker pings its row. Tightening lets
 * `lastSeenAt` track wall-clock more closely; loosening cuts
 * write traffic on idle workers. `NP_WORKER_HEARTBEAT_SECONDS`.
 */
export const WORKER_HEARTBEAT_INTERVAL_MS =
  readEnvPositiveInt("NP_WORKER_HEARTBEAT_SECONDS", 30) * 1_000;

/**
 * After how long with no heartbeat a worker is treated as
 * unhealthy in the admin UI / health check. Default 90s is
 * `3 × HEARTBEAT_INTERVAL` so a single missed beat doesn't trip
 * the alarm. `NP_WORKER_STALE_THRESHOLD_SECONDS`.
 */
export const WORKER_STALE_THRESHOLD_MS =
  readEnvPositiveInt("NP_WORKER_STALE_THRESHOLD_SECONDS", 90) * 1_000;

export interface NpWorkerHeartbeat {
  id: string;
  status: string;
  startedAt: Date;
  lastSeenAt: Date;
  meta: Record<string, unknown>;
}

export interface NpWorkerHealthSummary {
  workers: Array<NpWorkerHeartbeat & { alive: boolean; lastSeenAgoMs: number }>;
  aliveCount: number;
  totalCount: number;
  /** ISO timestamp of the most recent heartbeat across all workers. */
  newestHeartbeat: string | null;
}

function generateWorkerId(): string {
  // Hostname is shared across pods on the same VM but differs
  // across containers. Adding the PID + a short random suffix
  // keeps the id stable across short crashes (same PID under
  // same hostname overwrites the row) while still differing
  // between fresh process starts. Falls back to a UUID when
  // hostname / pid aren't readable (rare; mostly for
  // non-Node runtimes).
  try {
    const host = hostname();
    return `${host}:${process.pid}`;
  } catch {
    return randomUUID();
  }
}

/**
 * Stamp a single heartbeat row. Used by `startHeartbeatLoop`
 * and exposed for tests so they can inject fake worker rows
 * without spinning up a real interval.
 */
export async function recordHeartbeat(
  workerId: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const now = new Date();
  await db
    .insert(npWorkerHeartbeats)
    .values({
      id: workerId,
      status: "running",
      startedAt: now,
      lastSeenAt: now,
      meta,
    })
    .onConflictDoUpdate({
      target: npWorkerHeartbeats.id,
      set: { lastSeenAt: now, status: "running", meta },
    });
}

/**
 * Mark the row as `stopped` so the admin sees a graceful
 * shutdown rather than the row drifting into `unhealthy`.
 */
export async function markWorkerStopped(workerId: string): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await db
    .update(npWorkerHeartbeats)
    .set({ status: "stopped", lastSeenAt: new Date() })
    .where(eq(npWorkerHeartbeats.id, workerId));
}

/**
 * Read every worker row, decorate with `alive` + `lastSeenAgoMs`
 * relative to `now`. Sorted with the most recent heartbeat
 * first so the admin's first row is the freshest worker.
 */
export async function listWorkerHealth(now: Date = new Date()): Promise<NpWorkerHealthSummary> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const rows = (await db
    .select()
    .from(npWorkerHeartbeats)
    .orderBy(desc(npWorkerHeartbeats.lastSeenAt))) as NpWorkerHeartbeat[];

  let aliveCount = 0;
  const decorated = rows.map((row) => {
    const lastSeenAgoMs = Math.max(0, now.getTime() - row.lastSeenAt.getTime());
    const alive = row.status === "running" && lastSeenAgoMs < WORKER_STALE_THRESHOLD_MS;
    if (alive) aliveCount += 1;
    return { ...row, alive, lastSeenAgoMs };
  });

  return {
    workers: decorated,
    aliveCount,
    totalCount: rows.length,
    newestHeartbeat: rows[0]?.lastSeenAt.toISOString() ?? null,
  };
}

interface HeartbeatLoopHandle {
  workerId: string;
  stop(): Promise<void>;
}

/**
 * Spin up a recurring heartbeat. Returns a handle the caller
 * keeps so they can stop it on shutdown. Errors inside the
 * loop are logged and continued — a transient DB blip
 * shouldn't crash the worker, the next tick recovers.
 */
export function startHeartbeatLoop(
  meta: Record<string, unknown> = {},
  intervalMs: number = WORKER_HEARTBEAT_INTERVAL_MS,
): HeartbeatLoopHandle {
  const workerId = generateWorkerId();
  const log = getLogger();

  const beat = async (): Promise<void> => {
    try {
      await recordHeartbeat(workerId, meta);
    } catch (err) {
      log.warn("worker heartbeat failed", {
        workerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Beat immediately so the row exists from t=0; subsequent
  // beats happen on the interval. `setInterval` returns a
  // Timeout we keep so we can clear it on stop.
  void beat();
  const timer = setInterval(() => {
    void beat();
  }, intervalMs);
  // Don't keep the event loop alive on the heartbeat alone —
  // the worker has its own keep-alive (pg-boss); the heartbeat
  // is bookkeeping.
  if (typeof timer.unref === "function") timer.unref();

  return {
    workerId,
    async stop() {
      clearInterval(timer);
      try {
        await markWorkerStopped(workerId);
      } catch (err) {
        log.warn("worker heartbeat stop failed to mark row", {
          workerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * Manual GC hook — purge worker rows whose `last_seen_at` is
 * older than `olderThan`. Operators can call this from a
 * cron / admin action when the table accumulates ghosts.
 */
export async function purgeStaleWorkers(
  olderThan: Date = new Date(Date.now() - WORKER_STALE_THRESHOLD_MS * 10),
): Promise<number> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const deleted = (await db
    .delete(npWorkerHeartbeats)
    .where(lt(npWorkerHeartbeats.lastSeenAt, olderThan))
    .returning({ id: npWorkerHeartbeats.id })) as Array<{ id: string }>;
  return deleted.length;
}

/** Return only the rows currently considered alive. Cheap probe for boot health. */
export async function countAliveWorkers(now: Date = new Date()): Promise<number> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const cutoff = new Date(now.getTime() - WORKER_STALE_THRESHOLD_MS);
  const rows = (await db
    .select({ id: npWorkerHeartbeats.id })
    .from(npWorkerHeartbeats)
    .where(gt(npWorkerHeartbeats.lastSeenAt, cutoff))) as Array<{ id: string }>;
  return rows.length;
}
