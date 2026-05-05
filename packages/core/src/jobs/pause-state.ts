import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { getLogger } from "../observability/logger.js";
import { reportError } from "../observability/error-reporter.js";
import { type NpJobQueue } from "./queue.js";

/**
 * Phase 20.2 — global pause / resume for job processing.
 *
 * Stored in `nx_settings` under a deliberately reserved
 * `siteId="_system"` key. The pause flag is process-wide
 * (a maintenance window pauses everything, not per-tenant)
 * so it sits outside the per-site settings space. Reads /
 * writes go through this module rather than `getSetting`
 * because the latter scopes by request site.
 */
const SYSTEM_SITE_ID = "_system";
const JOBS_PAUSED_KEY = "jobs.paused";

export interface NpJobsPauseState {
  paused: boolean;
  /** ISO timestamp captured the last time the flag flipped. */
  changedAt: string;
  /** User id (staff) who flipped the flag, when known. */
  changedByUserId: string | null;
  /** Optional note an operator can leave for the next person. */
  reason: string | null;
}

const DEFAULT_STATE: NpJobsPauseState = {
  paused: false,
  changedAt: new Date(0).toISOString(),
  changedByUserId: null,
  reason: null,
};

export async function getJobsPauseState(): Promise<NpJobsPauseState> {
  const db = getDb();
  const rows = await db
    .select()
    .from(npSettings)
    .where(and(eq(npSettings.siteId, SYSTEM_SITE_ID), eq(npSettings.key, JOBS_PAUSED_KEY)))
    .limit(1);

  const row = rows[0];
  if (!row) return DEFAULT_STATE;

  const value = row.value as Partial<NpJobsPauseState> | null;
  if (!value || typeof value.paused !== "boolean") return DEFAULT_STATE;

  return {
    paused: value.paused,
    changedAt: typeof value.changedAt === "string" ? value.changedAt : DEFAULT_STATE.changedAt,
    changedByUserId: typeof value.changedByUserId === "string" ? value.changedByUserId : null,
    reason: typeof value.reason === "string" ? value.reason : null,
  };
}

export interface SetJobsPauseStateInput {
  paused: boolean;
  changedByUserId?: string | null;
  reason?: string | null;
}

export async function setJobsPauseState(input: SetJobsPauseStateInput): Promise<NpJobsPauseState> {
  const db = getDb();
  const next: NpJobsPauseState = {
    paused: input.paused,
    changedAt: new Date().toISOString(),
    changedByUserId: input.changedByUserId ?? null,
    reason: input.reason ?? null,
  };

  await db
    .insert(npSettings)
    .values({
      siteId: SYSTEM_SITE_ID,
      key: JOBS_PAUSED_KEY,
      value: next,
    })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: {
        value: next,
        updatedAt: new Date(),
      },
    });

  return next;
}

export const PAUSE_SYNC_INTERVAL_MS = 30_000;

/**
 * Number of consecutive failures before the loop escalates from a
 * `warn` log to the error reporter. Three ticks at 30s = ~90s of
 * sync drift before an operator gets a tracked alert; tunable here
 * if real-world fault profiles call for tighter or looser
 * thresholds.
 */
export const PAUSE_SYNC_ESCALATE_AFTER = 3;

export interface PauseSyncLoopHandle {
  stop(): void;
}

/**
 * Phase 20.2 — multi-pod pause sync. Each worker pod polls the
 * persisted flag on this cadence (default 30 s, matching the
 * heartbeat) and applies any state change locally. So an
 * operator pausing on pod A also stops pod B within roughly
 * one tick, instead of waiting for pod B to restart.
 *
 * Returns a handle whose `stop()` clears the interval. Read
 * errors are logged at warn — we don't want a transient DB
 * blip to wedge the worker. After
 * `PAUSE_SYNC_ESCALATE_AFTER` consecutive failures (#312),
 * the next failure is also reported via `reportError` so an
 * operator monitoring Sentry / their tracker sees the pod has
 * been silently out of sync. The counter resets on the next
 * successful tick.
 */
export function startPauseSyncLoop(
  queue: NpJobQueue,
  intervalMs: number = PAUSE_SYNC_INTERVAL_MS,
): PauseSyncLoopHandle {
  const log = getLogger();
  let consecutiveFailures = 0;
  let escalated = false;

  const tick = async (): Promise<void> => {
    try {
      const persisted = await getJobsPauseState();
      const localPaused =
        typeof queue.isProcessingPaused === "function" ? queue.isProcessingPaused() : false;

      if (persisted.paused && !localPaused && typeof queue.pauseProcessing === "function") {
        await queue.pauseProcessing();
        log.info("Pause sync: applied paused=true from settings", {
          changedAt: persisted.changedAt,
        });
      } else if (!persisted.paused && localPaused && typeof queue.resumeProcessing === "function") {
        await queue.resumeProcessing();
        log.info("Pause sync: applied paused=false from settings", {
          changedAt: persisted.changedAt,
        });
      }

      // Successful tick — clear the run of failures so a single
      // recovery resets the escalation gate.
      if (consecutiveFailures > 0) {
        log.info("Pause sync: recovered after consecutive failures", {
          previousFailures: consecutiveFailures,
        });
        consecutiveFailures = 0;
        escalated = false;
      }
    } catch (err) {
      consecutiveFailures += 1;
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn("Pause sync tick failed", {
        error: errorMessage,
        consecutiveFailures,
      });

      // After `PAUSE_SYNC_ESCALATE_AFTER` consecutive failures,
      // surface the error to the configured reporter so silent
      // out-of-sync state is visible to operators. Escalate
      // exactly once per failure run; the success branch above
      // resets `escalated` so a subsequent run can re-alert.
      if (consecutiveFailures >= PAUSE_SYNC_ESCALATE_AFTER && !escalated) {
        escalated = true;
        const reportable = err instanceof Error ? err : new Error(errorMessage);
        await reportError(reportable, {
          tags: { source: "worker", subsystem: "pause-sync" },
          extra: { consecutiveFailures },
        });
      }
    }
  };

  // Tick once immediately so a worker booted just before a
  // pause API call doesn't process up to one full interval's
  // worth of jobs before it sees the flag. Mirrors the pattern
  // in `startHeartbeatLoop`.
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
