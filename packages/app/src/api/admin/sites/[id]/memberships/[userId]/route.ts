import {
  NpForbiddenError,
  NpValidationError,
  getSiteById,
  revokeSiteMembership,
} from "@nexpress/core";
import { canOnSite } from "@nexpress/core/sites";
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

    if (!(await canOnSite(user, "admin.manage", id))) {
      throw new NpForbiddenError("memberships", "delete");
    }

    await revokeSiteMembership(id, userId);
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
