import {
  NpValidationError,
  markAllNotificationsRead,
  markNotificationsRead,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";
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
    const body = (await readJsonBody(request).catch(() => null)) as
      | { all?: unknown; ids?: unknown }
      | null;

    if (body?.all === true) {
      const count = await markAllNotificationsRead(member.id);
      return npSuccessResponse({ marked: count, all: true });
    }

    const idsRaw = body?.ids;
    if (!Array.isArray(idsRaw) || !idsRaw.every((id) => typeof id === "string")) {
      throw new NpValidationError("Invalid input", [
        { field: "ids", message: "ids must be a string[] (or pass `all: true`)" },
      ]);
    }
    const count = await markNotificationsRead({ memberId: member.id, notificationIds: idsRaw });
    return npSuccessResponse({ marked: count });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
