import { NpValidationError, isFollowing } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";
import { requireMember } from "../../../lib/member-auth-helpers";

const SUPPORTED = ["member", "thread", "tag"] as const;
type FollowTarget = (typeof SUPPORTED)[number];

/**
 * Single-target probe used by site UI follow buttons. The bulk
 * `GET /api/follows` returns the caller's full follow list, which is
 * the wrong shape for "is the viewer following this one profile?" —
 * a member who follows 200+ people would get truncated state otherwise.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const url = request.nextUrl;
    const targetType = url.searchParams.get("targetType") ?? "";
    const targetId = url.searchParams.get("targetId") ?? "";
    if (!(SUPPORTED as readonly string[]).includes(targetType) || !targetId) {
      throw new NpValidationError("Invalid input", [
        {
          field: "target",
          message: `targetType (${SUPPORTED.join("|")}) and targetId required`,
        },
      ]);
    }
    const following = await isFollowing({
      followerId: member.id,
      targetType: targetType as FollowTarget,
      targetId,
    });
    return npSuccessResponse({ following });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
