import {
  can,
  NpForbiddenError,
  getJobsPauseState,
  getOptionalJobQueue,
  listRecentJobFailures,
  listWorkerHealth,
  WORKER_STALE_THRESHOLD_MS,
} from "@nexpress/core";
import {
  npRequireJobsHealthWire,
  npSerializeWorkerHealthEntry,
} from "@nexpress/core/jobs-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor, nexpressConfig } from "../../../../lib/init-core";
import { npParseEmptyJobQuery, npRequireJobApiResponse } from "../../../../lib/job-api-contract";

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
 * Gated to `admin.manage` — same level as the jobs list itself.
 * Worker health, pause state, and stuck-job counts are operational
 * details that should not leak to editors.
 */

const DEFAULT_FAILED_THRESHOLD = 10;
const DEFAULT_EXPIRED_THRESHOLD = 50;

export async function GET(request: NextRequest) {
  try {
    // Health includes queue state counts and recent failures, so the same
    // producer adapter used by the jobs list must be initialized first.
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("workers", "read");
    }
    npParseEmptyJobQuery(request.nextUrl.searchParams);

    const queue = getOptionalJobQueue();
    const now = new Date();
    const [summary, pauseState, counts, recent] = await Promise.all([
      listWorkerHealth(now),
      getJobsPauseState(),
      queue && typeof queue.countByState === "function" ? queue.countByState() : null,
      listRecentJobFailures(queue, { limit: 5 }),
    ]);

    const configured = nexpressConfig.jobs?.stuckThreshold;
    const thresholds = {
      failed: configured?.failed ?? DEFAULT_FAILED_THRESHOLD,
      expired: configured?.expired ?? DEFAULT_EXPIRED_THRESHOLD,
    };
    const stuck = counts ? { counts, thresholds } : null;

    return npSuccessResponse(
      npRequireJobApiResponse(
        {
          workers: summary.workers.map((worker) =>
            npSerializeWorkerHealthEntry(
              {
                id: worker.id,
                status: worker.status,
                startedAt: worker.startedAt,
                lastSeenAt: worker.lastSeenAt,
                meta: worker.meta,
              },
              now,
              WORKER_STALE_THRESHOLD_MS,
            ),
          ),
          aliveCount: summary.aliveCount,
          totalCount: summary.totalCount,
          newestHeartbeat: summary.newestHeartbeat,
          pause: pauseState,
          stuck,
          recentFailures: recent.failures,
        },
        npRequireJobsHealthWire,
      ),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
