import {
  NxForbiddenError,
  hasRole,
  revokeUserIdentity,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Revoke a single OAuth identity link from a staff user. Idempotent
 * intent — but a 404 surface lets the admin tell the difference
 * between "already gone" and "wrong id". Re-linking is one OAuth
 * sign-in away; revocation does not invalidate sessions.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; identityId: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("user.identities", "revoke");
    }
    const { id, identityId } = await context.params;
    await revokeUserIdentity(id, identityId, { staffUserId: user.id });
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
