import { NxForbiddenError, getOptionalJobQueue, hasRole, setJobsPauseState } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";
import { readJsonBody } from "@nexpress/next";

/**
 * Phase 20.2 — pause job processing. Persists the flag in
 * `nx_settings` (siteId="_system") so it survives worker
 * restarts, and applies it to the local pg-boss adapter so
 * the in-process worker stops claiming jobs immediately.
 *
 * Multi-pod deployments: this PR only affects the pod that
 * receives the request. Other worker pods will see the
 * persisted flag on their next restart. A periodic poll to
 * sync running pods is a follow-up (tracked in jobs.md §12
 * "What's Not Built").
 *
 * Admin-only + CSRF, matching the rest of the jobs admin.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    requireCsrf(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("jobs", "pause");
    }

    const body = (await readJsonBody(request).catch(() => ({}))) as {
      reason?: string | null;
    };

    const state = await setJobsPauseState({
      paused: true,
      changedByUserId: user.id,
      reason: typeof body?.reason === "string" ? body.reason : null,
    });

    const queue = getOptionalJobQueue();
    if (queue && typeof queue.pauseProcessing === "function") {
      await queue.pauseProcessing();
    }

    return nxSuccessResponse({
      paused: state.paused,
      changedAt: state.changedAt,
      reason: state.reason,
      // `localApplied` tells the admin UI whether the in-process
      // adapter was paused too (vs only the persisted flag flipped,
      // which is what happens in the API process when the worker
      // is in a separate container).
      localApplied: Boolean(queue) && typeof queue?.pauseProcessing === "function",
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
