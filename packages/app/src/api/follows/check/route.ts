import { isFollowing } from "@nexpress/core/community";
import { npRequireFollowingWire, npRequireFollowTarget } from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../lib/community-contract";
import { requireMember } from "../../../lib/member-auth-helpers";

/**
 * Single-target probe used by site UI follow buttons. The bulk
 * `GET /api/follows` returns the caller's full follow list, which is
 * the wrong shape for "is the viewer following this one profile?" —
 * a member who follows 200+ people would get truncated state otherwise.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const member = await requireMember(request);
    const url = request.nextUrl;
    const { targetType, targetId } = npRequireCommunityRequest(npRequireFollowTarget, {
      targetType: url.searchParams.get("targetType"),
      targetId: url.searchParams.get("targetId"),
    });
    const following = await isFollowing({
      followerId: member.id,
      targetType,
      targetId,
    });
    return npSuccessResponse(npRequireFollowingWire({ following }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
