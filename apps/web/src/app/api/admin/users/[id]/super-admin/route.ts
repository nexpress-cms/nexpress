import {
  NxForbiddenError,
  NxValidationError,
  isSuperAdmin,
  setSuperAdmin,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 15.6 — promote / demote a user's super-admin flag.
 *
 *   PATCH /api/admin/users/{id}/super-admin
 *     body: { isSuperAdmin: boolean }
 *     → 200 { id, isSuperAdmin }
 *
 * Only existing super-admins can promote / demote others.
 * v1 doesn't allow self-demotion (would let a single
 * super-admin lock themselves out); operators who want to
 * change ownership promote a successor first, then have the
 * successor demote them.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);

    const callerIsSuper = await isSuperAdmin(user);
    if (!callerIsSuper) {
      throw new NxForbiddenError("users/super-admin", "update");
    }

    const { id } = await context.params;
    const body = (await readJsonBody(request)) as { isSuperAdmin?: unknown };
    if (typeof body.isSuperAdmin !== "boolean") {
      throw new NxValidationError("Invalid input", [
        { field: "isSuperAdmin", message: "boolean isSuperAdmin is required" },
      ]);
    }

    if (id === user.id && body.isSuperAdmin === false) {
      throw new NxValidationError("Invalid input", [
        {
          field: "isSuperAdmin",
          message:
            "Cannot demote yourself. Promote a successor first, then have them demote you.",
        },
      ]);
    }

    await setSuperAdmin(id, body.isSuperAdmin);
    return nxSuccessResponse({ id, isSuperAdmin: body.isSuperAdmin });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
