import { deleteComment, updateComment } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";
import { requireMember } from "@/lib/member-auth-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { bodyMd?: unknown } | null;
    const bodyMd = typeof body?.bodyMd === "string" ? body.bodyMd : "";

    const updated = await updateComment({ commentId: id, memberId: member.id, bodyMd });
    return nxSuccessResponse(updated);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
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
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
