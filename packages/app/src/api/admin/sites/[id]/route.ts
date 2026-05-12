import {
  NpForbiddenError,
  NpValidationError,
  deleteSite,
  getSiteById,
  isSuperAdmin,
  updateSite,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";
import { canManageSite } from "@/lib/site-authz";

/**
 * Phase 15.3 — per-site admin endpoints.
 *
 *   GET    /api/admin/sites/{id}    read one site
 *   PATCH  /api/admin/sites/{id}    update name / hostname / description
 *   DELETE /api/admin/sites/{id}    delete (default site is refused by
 *                                   the registry layer)
 *
 * Authorization ladder (`canManageSite` in `@/lib/site-authz`):
 *
 *   - Super-admin can read / update / delete any site.
 *   - A user with an explicit `np_site_memberships` row (with
 *     admin or above) can read / update *that* site only.
 *   - Global admin retains read/update on the default site to
 *     keep single-tenant deployments working without a super-
 *     admin flag (the same fallback the picker setter uses).
 *   - Delete stays super-admin only — removing a tenant is not
 *     a per-site operation; it strikes the row from the registry.
 */

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id } = await context.params;
    if (!(await canManageSite(user, id))) {
      throw new NpForbiddenError("sites", "read");
    }
    const site = await getSiteById(id);
    if (!site) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }
    return npSuccessResponse(site);
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id } = await context.params;
    if (!(await canManageSite(user, id))) {
      throw new NpForbiddenError("sites", "update");
    }
    const body = (await readJsonBody(request)) as {
      name?: unknown;
      hostname?: unknown;
      description?: unknown;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.hostname === "string" || body.hostname === null) {
      patch.hostname = body.hostname;
    }
    if (typeof body.description === "string" || body.description === null) {
      patch.description = body.description;
    }
    const site = await updateSite(id, patch);
    return npSuccessResponse(site);
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    // Issue #216 — site deletion is a registry-level operation.
    // Even a per-site admin shouldn't be able to remove the
    // tenant they happen to manage; super-admin only.
    if (!(await isSuperAdmin(user))) {
      throw new NpForbiddenError("sites", "delete");
    }
    const { id } = await context.params;
    // Phase 15.9 — `?cascade=true` opt-in. Default is the
    // safe path: deleteSite refuses if any site-scoped data
    // exists. Operators clicking "Delete site" through the
    // admin UI explicitly confirm cascade after seeing the
    // usage summary.
    const cascade = request.nextUrl.searchParams.get("cascade") === "true";
    await deleteSite(id, { cascade });
    return npSuccessResponse({ id, deleted: true, cascade });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
