import { NxForbiddenError, isStaffMod, staffDeleteComment } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    requireCsrf(request);
    if (!isStaffMod(user)) {
      throw new NxForbiddenError("comments", "delete");
    }

    const { id } = await params;
    await staffDeleteComment(id, user.id);
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
