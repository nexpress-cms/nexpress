import {
  npListContentEngagement,
  npRequireReadableCommunityDocument,
  npResolveDocumentCommunityTarget,
} from "@nexpress/core/community";
import {
  npRequireContentEngagementSummary,
  npRequireEngagementTarget,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { npRequireCommunityRequest } from "../../lib/community-contract";
import { optionalMember } from "../../lib/member-auth-helpers";

/** Current public engagement snapshot used after realtime invalidations. */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const member = await optionalMember(request);
    const target = npRequireCommunityRequest(npRequireEngagementTarget, {
      targetType: request.nextUrl.searchParams.get("targetType"),
      targetId: request.nextUrl.searchParams.get("targetId"),
    });
    const resolved = await npResolveDocumentCommunityTarget(target.targetType, target.targetId);
    await npRequireReadableCommunityDocument(
      resolved.collection,
      resolved.document,
      member ? { kind: "member", memberId: member.id } : null,
    );
    const [summary] = await npListContentEngagement(target.targetType, [target.targetId]);
    if (!summary) throw new Error("Engagement summary did not include the requested target.");
    return npSuccessResponse(npRequireContentEngagementSummary(summary), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
