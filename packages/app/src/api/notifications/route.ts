import { listNotifications, unreadNotificationCount } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { requireMember } from "../../lib/member-auth-helpers";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const member = await requireMember(request);
    const url = request.nextUrl;

    // `?count=1` is the lightweight "give me only the unread badge"
    // probe used by header notification icons.
    if (url.searchParams.get("count") === "1") {
      const unread = await unreadNotificationCount(member.id);
      return npSuccessResponse({ unread });
    }

    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const result = await listNotifications(member.id, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      unreadOnly,
    });
    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
