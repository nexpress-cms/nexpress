import {
  NxValidationError,
  markAllNotificationsRead,
  markNotificationsRead,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureWriteReady } from "@/lib/init-core";
import { requireMember, requireMemberCsrf } from "@/lib/member-auth-helpers";

/**
 * Two modes:
 *  - `{ all: true }` — mark every unread row read.
 *  - `{ ids: [...] }` — mark only those rows (max 200). Ids that
 *    don't belong to the caller silently no-op so a leaked id can't
 *    be acknowledged by another member.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const member = await requireMember(request);
    requireMemberCsrf(request);
    const body = (await readJsonBody(request).catch(() => null)) as
      | { all?: unknown; ids?: unknown }
      | null;

    if (body?.all === true) {
      const count = await markAllNotificationsRead(member.id);
      return nxSuccessResponse({ marked: count, all: true });
    }

    const idsRaw = body?.ids;
    if (!Array.isArray(idsRaw) || !idsRaw.every((id) => typeof id === "string")) {
      throw new NxValidationError("Invalid input", [
        { field: "ids", message: "ids must be a string[] (or pass `all: true`)" },
      ]);
    }
    const count = await markNotificationsRead({ memberId: member.id, notificationIds: idsRaw });
    return nxSuccessResponse({ marked: count });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
