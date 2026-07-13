import { NpForbiddenError, revokeMemberIdentity, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";

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
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("member.identities", "revoke");
    }
    const { id, identityId } = await context.params;
    await revokeMemberIdentity(id, identityId, { staffUserId: user.id });
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
