import { can, NpForbiddenError } from "@nexpress/core";
import { revokeMemberRole } from "@nexpress/core/community";
import { npRequireOkWire } from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("memberRoleGrants", "delete");
    }
    const { id } = await params;
    await revokeMemberRole({ grantId: id, revokedByUserId: user.id });
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
