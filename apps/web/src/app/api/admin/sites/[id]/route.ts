import {
  NX_DEFAULT_SITE_ID,
  NxForbiddenError,
  NxValidationError,
  type NxAuthUser,
  ROLE_HIERARCHY,
  deleteSite,
  getMembership,
  getSiteById,
  hasRole,
  isSuperAdmin,
  updateSite,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 15.3 — per-site admin endpoints.
 *
 *   GET    /api/admin/sites/{id}    read one site
 *   PATCH  /api/admin/sites/{id}    update name / hostname / description
 *   DELETE /api/admin/sites/{id}    delete (default site is refused by
 *                                   the registry layer)
 *
 * Issue #216 — gate per-site access by site membership rather
 * than the global admin role:
 *
 *   - Super-admin can read / update / delete any site.
 *   - A user with an explicit `nx_site_memberships` row (with
 *     admin or above) can read / update *that* site only.
 *   - Global admin retains read/update on the default site to
 *     keep single-tenant deployments working without a super-
 *     admin flag (the same fallback the picker setter uses).
 *   - Delete stays super-admin only — removing a tenant is not
 *     a per-site operation; it strikes the row from the registry.
 */
async function canManageSite(user: NxAuthUser, siteId: string): Promise<boolean> {
  if (await isSuperAdmin(user)) return true;
  if (siteId === NX_DEFAULT_SITE_ID && hasRole(user, "admin")) return true;
  // Issue #216 — `hasRoleOnSite` falls back to the user's
  // global role when no explicit membership exists on the
  // target site, which would let any global admin manage
  // every site (the bug this issue closes). Read membership
  // directly so the gate only opens for users with an
  // explicit `nx_site_memberships` row at admin rank or
  // above on this specific site.
  const membership = await getMembership(siteId, user.id);
  if (!membership) return false;
  return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY.admin;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    const { id } = await context.params;
    if (!(await canManageSite(user, id))) {
      throw new NxForbiddenError("sites", "read");
    }
    const site = await getSiteById(id);
    if (!site) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }
    return nxSuccessResponse(site);
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    const { id } = await context.params;
    if (!(await canManageSite(user, id))) {
      throw new NxForbiddenError("sites", "update");
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
    return nxSuccessResponse(site);
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    // Issue #216 — site deletion is a registry-level operation.
    // Even a per-site admin shouldn't be able to remove the
    // tenant they happen to manage; super-admin only.
    if (!(await isSuperAdmin(user))) {
      throw new NxForbiddenError("sites", "delete");
    }
    const { id } = await context.params;
    // Phase 15.9 — `?cascade=true` opt-in. Default is the
    // safe path: deleteSite refuses if any site-scoped data
    // exists. Operators clicking "Delete site" through the
    // admin UI explicitly confirm cascade after seeing the
    // usage summary.
    const cascade = request.nextUrl.searchParams.get("cascade") === "true";
    await deleteSite(id, { cascade });
    return nxSuccessResponse({ id, deleted: true, cascade });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
