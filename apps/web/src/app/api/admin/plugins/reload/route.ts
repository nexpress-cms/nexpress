import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { reloadPlugins } from "@/lib/bootstrap";
import { ensureFor } from "@/lib/init-core";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";

/**
 * Phase 5.1 — soft reload of the plugin registry. Wipes every registered
 * hook, route, action, and scheduled task, then re-runs the bootstrap's
 * load pipeline. After this returns, the next request sees the same
 * plugin set with fresh `setup(ctx)` invocations + DB-backed config.
 *
 * Use cases:
 *   - Toggled a plugin and want pre-existing in-memory state cleared
 *     (the enabled-gate already handles dispatch, but `setup()` only
 *      re-runs after a reload).
 *   - Edited a plugin's manifest and want the new declared schedules /
 *     admin extensions to take effect without a server restart.
 *
 * Does NOT bust the Node module cache, so changes to plugin handler
 * code still need a dev-server restart. Documented in the toast.
 *
 * Capability-gated on `admin.manage`.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins", "reload");
    }

    // Make sure core services + the queue are wired before we tear down
    // the registry — the reload below ends with a fresh ensurePluginsLoaded()
    // that needs the DB + storage adapter ready. Use `"write"` so the job
    // queue producer is guaranteed up; the schedule reconcile inside
    // `reloadPlugins()` needs `getOptionalJobQueue()` to return a real
    // adapter instead of null on a fresh request.
    await ensureFor("write");
    const result = await reloadPlugins();

    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
