import { restoreComment } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";
import { requireMember } from "@/lib/member-auth-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    await restoreComment({ commentId: id, memberId: member.id });
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
