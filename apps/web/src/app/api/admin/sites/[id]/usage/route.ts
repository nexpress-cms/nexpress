import {
  NxForbiddenError,
  NxValidationError,
  getSiteById,
  getSiteUsageSummary,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

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
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("sites/usage", "read");
    }
    const { id } = await context.params;
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
