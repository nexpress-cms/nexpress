import {
  NxForbiddenError,
  getCommunitySettings,
  updateCommunitySettings,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Read community settings — site-wide knobs that gate registration
 * and reactions. Mods can read so the moderation surface can hint at
 * the active policy ("registration is closed; manual provisioning
 * required"); only admins can write.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    // `isStaffMod` (admin/editor/moderator) — `can(user, "content.author")`
    // would accept `author` too because moderator and author share rank
    // 1 in `ROLE_HIERARCHY`.
    if (!can(user, "community.moderate")) {
      throw new NxForbiddenError("community.settings", "read");
    }
    const settings = await getCommunitySettings();
    return nxSuccessResponse(settings);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("community.settings", "update");
    }
    const body = await readJsonBody(request);
    const updated = await updateCommunitySettings(body, user.id);
    return nxSuccessResponse(updated);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
