import { NpForbiddenError, can } from "@nexpress/core";
import { getCommunitySettings, updateCommunitySettings } from "@nexpress/core/community";
import {
  npRequireCommunitySettings,
  npRequireCommunitySettingsPatch,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../lib/community-contract";

/**
 * Read community settings — site-wide knobs that gate registration
 * and reactions. Mods can read so the moderation surface can hint at
 * the active policy ("registration is closed; manual provisioning
 * required"); only admins can write.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    // `community.moderate` deliberately excludes authors; moderator and
    // author are parallel capability roles, not points on one rank ladder.
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("community.settings", "read");
    }
    const settings = await getCommunitySettings();
    return npSuccessResponse(npRequireCommunitySettings(settings));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("community.settings", "update");
    }
    const body = await readJsonBody(request);
    npRequireCommunityRequest(npRequireCommunitySettingsPatch, body);
    const updated = await updateCommunitySettings(body, user.id);
    return npSuccessResponse(npRequireCommunitySettings(updated));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
