import { markAllNotificationsRead, markNotificationsRead } from "@nexpress/core/community";
import {
  npRequireMarkNotificationsReadRequest,
  npRequireMarkNotificationsReadWire,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../lib/community-contract";
import { requireMember } from "../../../lib/member-auth-helpers";

/**
 * Two modes:
 *  - `{ all: true }` — mark every unread row read.
 *  - `{ ids: [...] }` — mark only those rows (max 200). Ids that
 *    don't belong to the caller silently no-op so a leaked id can't
 *    be acknowledged by another member.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const body = npRequireCommunityRequest(
      npRequireMarkNotificationsReadRequest,
      await readJsonBody(request).catch(() => null),
    );

    if ("all" in body) {
      const count = await markAllNotificationsRead(member.id);
      return npSuccessResponse(npRequireMarkNotificationsReadWire({ marked: count, all: true }));
    }
    const count = await markNotificationsRead({ memberId: member.id, notificationIds: body.ids });
    return npSuccessResponse(npRequireMarkNotificationsReadWire({ marked: count }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
