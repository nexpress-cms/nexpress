import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { nxSettings } from "../db/schema/system.js";
import { getLogger } from "../observability/logger.js";
import { type NxJobQueue } from "./queue.js";

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

export interface NxJobsPauseState {
  paused: boolean;
  /** ISO timestamp captured the last time the flag flipped. */
  changedAt: string;
  /** User id (staff) who flipped the flag, when known. */
  changedByUserId: string | null;
  /** Optional note an operator can leave for the next person. */
  reason: string | null;
}

const DEFAULT_STATE: NxJobsPauseState = {
  paused: false,
  changedAt: new Date(0).toISOString(),
  changedByUserId: null,
  reason: null,
};

export async function getJobsPauseState(): Promise<NxJobsPauseState> {
  const db = getDb();
  const rows = await db
    .select()
    .from(nxSettings)
    .where(and(eq(nxSettings.siteId, SYSTEM_SITE_ID), eq(nxSettings.key, JOBS_PAUSED_KEY)))
    .limit(1);

  const row = rows[0];
  if (!row) return DEFAULT_STATE;

  const value = row.value as Partial<NxJobsPauseState> | null;
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

export async function setJobsPauseState(input: SetJobsPauseStateInput): Promise<NxJobsPauseState> {
  const db = getDb();
  const next: NxJobsPauseState = {
    paused: input.paused,
    changedAt: new Date().toISOString(),
    changedByUserId: input.changedByUserId ?? null,
    reason: input.reason ?? null,
  };

  await db
    .insert(nxSettings)
    .values({
      siteId: SYSTEM_SITE_ID,
      key: JOBS_PAUSED_KEY,
      value: next,
    })
    .onConflictDoUpdate({
      target: [nxSettings.siteId, nxSettings.key],
      set: {
        value: next,
        updatedAt: new Date(),
      },
    });

  return next;
}

export const PAUSE_SYNC_INTERVAL_MS = 30_000;

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
 * blip to wedge the worker.
 */
export function startPauseSyncLoop(
  queue: NxJobQueue,
  intervalMs: number = PAUSE_SYNC_INTERVAL_MS,
): PauseSyncLoopHandle {
  const log = getLogger();

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
    } catch (err) {
      log.warn("Pause sync tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
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
