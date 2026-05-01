import {
  NxForbiddenError,
  revokeMemberIdentity,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Revoke a single OAuth identity link from a member. Admin-only:
 * read access is open to editors-and-up so mods can investigate, but
 * destructive action is gated to admin. Re-linking is one OAuth
 * sign-in away; revocation does not invalidate member sessions.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; identityId: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("member.identities", "revoke");
    }
    const { id, identityId } = await context.params;
    await revokeMemberIdentity(id, identityId, { staffUserId: user.id });
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
