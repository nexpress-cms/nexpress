import { listNotifications, unreadNotificationCount } from "@nexpress/core/community";
import {
  npRequireNotificationListWire,
  npRequireUnreadWire,
  npToNotificationWireRow,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { npReadCommunityWindow } from "../../lib/community-contract";
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
      return npSuccessResponse(npRequireUnreadWire({ unread }));
    }

    const { limit, offset } = npReadCommunityWindow(url.searchParams);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const result = await listNotifications(member.id, {
      limit,
      offset,
      unreadOnly,
    });
    return npSuccessResponse(
      npRequireNotificationListWire({
        notifications: result.notifications.map(npToNotificationWireRow),
        totalDocs: result.totalDocs,
        unread: result.unread,
      }),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
