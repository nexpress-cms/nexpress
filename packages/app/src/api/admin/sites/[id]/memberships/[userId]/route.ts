import {
  NpForbiddenError,
  NpValidationError,
  getMembership,
  getSiteById,
  isSuperAdmin,
  revokeSiteMembership,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";

/**
 * Phase 15.6 — DELETE /api/admin/sites/{id}/memberships/{userId}
 * revokes a specific user's membership on a site.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id, userId } = await context.params;

    const target = await getSiteById(id);
    if (!target) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }

    const superAdmin = await isSuperAdmin(user);
    if (!superAdmin) {
      // Same per-site-admin check as the parent route's GET.
      const callerMembership = await getMembership(id, user.id);
      const isDefaultGlobalAdmin = id === "default" && user.role === "admin";
      if (callerMembership?.role !== "admin" && !isDefaultGlobalAdmin) {
        throw new NpForbiddenError("memberships", "delete");
      }
    }

    await revokeSiteMembership(id, userId);
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
