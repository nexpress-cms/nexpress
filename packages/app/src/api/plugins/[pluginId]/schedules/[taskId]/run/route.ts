import {
  NpForbiddenError,
  NpNotFoundError,
  can,
  getPluginRegistration,
  schedulePluginTask,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 4.2 — fire a registered plugin schedule on demand. Enqueues the
 * same `plugin:scheduledTask` job pg-boss would have fired on its next
 * cron tick, so the manual run goes through the identical retry / log
 * path. Useful for "I changed the cron expression and want to verify the
 * handler still works without waiting an hour."
 *
 * Gated on `admin.manage` to match the rest of `/admin/plugins`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string; taskId: string }> },
) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugin-schedule", "run");
    }

    await ensureFor("write");

    const { pluginId, taskId } = await params;
    const reg = getPluginRegistration(pluginId);
    if (!reg) {
      throw new NpNotFoundError("plugin", pluginId);
    }
    if (!reg.schedules.has(taskId)) {
      throw new NpNotFoundError("plugin-schedule", `${pluginId}/${taskId}`);
    }

    await schedulePluginTask(pluginId, taskId);
    return npSuccessResponse({ pluginId, taskId, enqueued: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
