import { hideComment } from "@nexpress/core/community";
import { npRequireCommentHideRequest, npRequireOkWire } from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../lib/community-contract";
import { requireMember } from "../../../../lib/member-auth-helpers";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    const { reason } = npRequireCommunityRequest(
      npRequireCommentHideRequest,
      await readJsonBody(request).catch(() => ({})),
    );
    await hideComment({ commentId: id, memberId: member.id, reason });
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
