import { NpValidationError } from "@nexpress/core";
import { moderateMemberThread } from "@nexpress/core/community";
import {
  npRequireEngagementTarget,
  npRequireOkWire,
  npRequireThreadModerationRequest,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { npRequireCommunityRequest } from "../../../../../lib/community-contract";
import { ensureFor } from "../../../../../lib/init-core";
import { requireMember } from "../../../../../lib/member-auth-helpers";
import { revalidateCollection } from "../../../../../lib/revalidate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { slug, id } = await params;
    const target = npRequireCommunityRequest(npRequireEngagementTarget, {
      targetType: slug,
      targetId: id,
    });
    if (target.targetType === "comment") {
      throw new NpValidationError("Invalid thread moderation target", [
        { field: "slug", message: "Thread moderation requires a collection slug." },
      ]);
    }
    const checked = npRequireCommunityRequest(
      npRequireThreadModerationRequest,
      await readJsonBody(request),
    );
    const result = await moderateMemberThread({
      collection: target.targetType,
      documentId: target.targetId,
      memberId: member.id,
      action: checked.action,
      reason: checked.reason,
    });
    await revalidateCollection(target.targetType, result.doc);
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
