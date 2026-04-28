import { NxForbiddenError, getJobsPauseState, hasRole, listWorkerHealth } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureCoreServices } from "@/lib/init-core";

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
 * Gated to `editor` and above (the same level that sees the
 * jobs admin) — mods don't need this view.
 */
export async function GET(request: NextRequest) {
  try {
    ensureCoreServices();
    const user = await requireAuth(request);
    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("workers", "read");
    }
    const [summary, pauseState] = await Promise.all([listWorkerHealth(), getJobsPauseState()]);
    return nxSuccessResponse({
      ...summary,
      pause: pauseState,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
