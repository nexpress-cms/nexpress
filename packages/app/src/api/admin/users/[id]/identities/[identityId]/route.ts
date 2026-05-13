import {
  NpForbiddenError,
  revokeUserIdentity,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

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
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("user.identities", "revoke");
    }
    const { id, identityId } = await context.params;
    await revokeUserIdentity(id, identityId, { staffUserId: user.id });
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
