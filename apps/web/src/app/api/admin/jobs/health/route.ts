import {
  can,
  NxForbiddenError,
  getJobsPauseState,
  getOptionalJobQueue,
  listWorkerHealth,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor, nexpressConfig } from "@/lib/init-core";

/**
 * Phase 19 — worker liveness endpoint. Returns each registered
 * worker's heartbeat state plus an aggregate alive count so the
 * admin can answer "is anything draining the queue right now?"
 * at a glance.
 *
 * Phase 20.2 — also returns the global pause flag so the admin
 * UI can render a single "paused" pill alongside the worker
 * health summary instead of fetching two endpoints.
 *
 * Phase 23.5 — also returns per-state job counts plus the
 * configured stuck-job thresholds so the admin can spot a build-up
 * of failed/expired jobs without waiting for a worker to crash.
 * Counts come from `countByState` (UNION across pgboss.job and
 * pgboss.archive); thresholds default when the config doesn't
 * override them.
 *
 * Gated to `editor` and above (the same level that sees the
 * jobs admin) — mods don't need this view.
 */

const DEFAULT_FAILED_THRESHOLD = 10;
const DEFAULT_EXPIRED_THRESHOLD = 50;

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("workers", "read");
    }

    const queue = getOptionalJobQueue();
    const [summary, pauseState, counts] = await Promise.all([
      listWorkerHealth(),
      getJobsPauseState(),
      queue && typeof queue.countByState === "function" ? queue.countByState() : null,
    ]);

    const configured = nexpressConfig.jobs?.stuckThreshold;
    const thresholds = {
      failed: configured?.failed ?? DEFAULT_FAILED_THRESHOLD,
      expired: configured?.expired ?? DEFAULT_EXPIRED_THRESHOLD,
    };
    const stuck = counts
      ? {
          counts,
          thresholds,
          // Pre-computed booleans so the UI can pulse a warning
          // without re-implementing the comparison. Both fields
          // surface independently because failures and expirations
          // signal different operational stories (handler bug vs
          // worker not draining).
          failedOverThreshold: counts.failed >= thresholds.failed,
          expiredOverThreshold: counts.expired >= thresholds.expired,
        }
      : null;

    return nxSuccessResponse({
      ...summary,
      pause: pauseState,
      stuck,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
