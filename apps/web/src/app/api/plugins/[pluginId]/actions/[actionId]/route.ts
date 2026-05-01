import {
  NxForbiddenError,
  dispatchPluginAction,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { parseBodyRecord } from "@/lib/collection-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Admin-only dispatcher for plugin-registered actions. Admin UI widgets /
 * tables / action buttons POST here. Plugins register handlers via
 * `ctx.actions.register(actionId, handler)` during setup.
 *
 * The dispatcher returns the handler's `{ ok, data?, error? }` result as-is,
 * wrapped in the standard API success envelope. Handlers that throw turn
 * into 500s via nxErrorResponse — callers can distinguish "action failed
 * cleanly" (`{ ok: false, error }`) from "action crashed" (HTTP 500).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string; actionId: string }> },
) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("plugin action", "dispatch");
    }

    await ensureFor("plugins");

    const { pluginId, actionId } = await params;

    // Action payload is optional. When the request has no body, default to
    // undefined so handlers that expect no input don't get a surprise null.
    let payload: unknown = undefined;
    const raw = await request.text();
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        payload = parsed && typeof parsed === "object" ? parseBodyRecord(parsed) : parsed;
      } catch {
        payload = undefined;
      }
    }

    const result = await dispatchPluginAction(pluginId, actionId, payload);
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
