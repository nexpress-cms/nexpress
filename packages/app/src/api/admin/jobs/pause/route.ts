import { can, NpForbiddenError, getOptionalJobQueue, setJobsPauseState } from "@nexpress/core";
import { npRequirePauseJobsWire } from "@nexpress/core/jobs-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  npParseEmptyJobQuery,
  npParsePauseJobBody,
  npRequireJobApiResponse,
} from "../../../../lib/job-api-contract";
import { readJsonBody } from "@nexpress/next";

/**
 * Phase 20.2 — pause job processing. Persists the flag in
 * `np_settings` (siteId="_system") so it survives worker
 * restarts, and applies it to the local pg-boss adapter so
 * the in-process worker stops claiming jobs immediately.
 *
 * Multi-pod deployments: the local adapter updates immediately;
 * every other worker polls the persisted flag and converges within
 * the configured pause-sync interval.
 *
 * Admin-only + CSRF, matching the rest of the jobs admin.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "pause");
    }

    npParseEmptyJobQuery(request.nextUrl.searchParams);
    const { reason } = npParsePauseJobBody(await readJsonBody(request));

    const state = await setJobsPauseState({
      paused: true,
      changedByUserId: user.id,
      reason,
    });

    const queue = getOptionalJobQueue();
    if (queue && typeof queue.pauseProcessing === "function") {
      await queue.pauseProcessing();
    }

    return npSuccessResponse(
      npRequireJobApiResponse(
        {
          paused: state.paused,
          changedAt: state.changedAt,
          reason: state.reason,
          localApplied: Boolean(queue) && typeof queue?.pauseProcessing === "function",
        },
        npRequirePauseJobsWire,
      ),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
