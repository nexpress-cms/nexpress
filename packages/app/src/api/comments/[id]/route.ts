import { deleteComment, updateComment } from "@nexpress/core/community";
import {
  npRequireCommentUpdateRequest,
  npRequireOkWire,
  npToCommentWireRow,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../lib/community-contract";
import { requireMember } from "../../../lib/member-auth-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    const { bodyMd } = npRequireCommunityRequest(
      npRequireCommentUpdateRequest,
      await readJsonBody(request),
    );

    const updated = await updateComment({ commentId: id, memberId: member.id, bodyMd });
    return npSuccessResponse(npToCommentWireRow(updated));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    await deleteComment({ commentId: id, memberId: member.id });
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
