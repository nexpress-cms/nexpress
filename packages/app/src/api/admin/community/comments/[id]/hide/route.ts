import { can, NpForbiddenError } from "@nexpress/core";
import { staffHideComment } from "@nexpress/core/community";
import { npRequireCommentHideRequest, npRequireOkWire } from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../../../lib/community-contract";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("comments", "hide");
    }

    const { id } = await params;
    const { reason } = npRequireCommunityRequest(
      npRequireCommentHideRequest,
      await readJsonBody(request).catch(() => ({})),
    );
    await staffHideComment(id, user.id, reason);
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
