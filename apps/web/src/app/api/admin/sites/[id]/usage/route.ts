import {
  NxForbiddenError,
  NxValidationError,
  getSiteById,
  getSiteUsageSummary,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";
import { canManageSite } from "@/lib/site-authz";

/**
 * Phase 15.9 — per-site usage summary. Surfaces in the
 * admin delete-site dialog so operators see what they're
 * about to nuke (or leave behind as orphans, in the
 * non-cascade path).
 *
 * Returns the count of every site-scoped row attached to a
 * site: per-collection counts, settings, navigation,
 * memberships, string overrides. Admin-only because the
 * counts can hint at private content shape.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id } = await context.params;
    // Issue #366 — was gated only on global `admin.manage`, which
    // let a non-super global admin query any tenant's row counts
    // and learn private content shape. Use the same target-site
    // ladder as the sister site detail/update/delete routes.
    if (!(await canManageSite(user, id))) {
      throw new NxForbiddenError("sites/usage", "read");
    }
    const site = await getSiteById(id);
    if (!site) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }
    const usage = await getSiteUsageSummary(id);
    return nxSuccessResponse({ site: { id: site.id, name: site.name }, usage });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
