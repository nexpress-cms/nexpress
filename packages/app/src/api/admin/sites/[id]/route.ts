import {
  NpForbiddenError,
  NpValidationError,
  deleteSite,
  getSiteById,
  isSuperAdmin,
  updateSite,
} from "@nexpress/core";
import { invalidateCacheTargets, readJsonBody, siteCacheTag } from "@nexpress/next";
import { npSerializeSiteRecord } from "@nexpress/core/settings";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { canManageSite } from "../../../../lib/site-authz";

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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    return npSuccessResponse(npSerializeSiteRecord(site));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id } = await context.params;
    if (!(await canManageSite(user, id))) {
      throw new NpForbiddenError("sites", "update");
    }
    const value = await readJsonBody(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new NpValidationError("Invalid input", [
        { field: "body", message: "Request body must be a plain object" },
      ]);
    }
    const body = value as Record<string, unknown>;
    const unknown = Object.keys(body).find(
      (key) => key !== "name" && key !== "hostname" && key !== "description",
    );
    if (unknown) {
      throw new NpValidationError("Invalid input", [
        { field: unknown, message: `Unsupported site patch field "${unknown}"` },
      ]);
    }
    const patch: {
      name?: string;
      hostname?: string | null;
      description?: string | null;
    } = {};
    if ("name" in body) {
      if (typeof body.name !== "string") {
        throw new NpValidationError("Invalid input", [
          { field: "name", message: "name must be a string" },
        ]);
      }
      patch.name = body.name;
    }
    if ("hostname" in body) {
      if (typeof body.hostname !== "string" && body.hostname !== null) {
        throw new NpValidationError("Invalid input", [
          { field: "hostname", message: "hostname must be a string or null" },
        ]);
      }
      patch.hostname = body.hostname;
    }
    if ("description" in body) {
      if (typeof body.description !== "string" && body.description !== null) {
        throw new NpValidationError("Invalid input", [
          { field: "description", message: "description must be a string or null" },
        ]);
      }
      patch.description = body.description;
    }
    const site = await updateSite(id, patch);
    // Site name + hostname flow through `getCachedSite()` (600s TTL)
    // into every theme's masthead / footer / canonical URL. Without
    // this bust an admin rename surfaces on the public site after a
    // 10-minute stall.
    if (patch.name !== undefined || patch.hostname !== undefined) {
      invalidateCacheTargets({
        source: "site",
        siteId: id,
        tags: [siteCacheTag(id)],
        paths: [{ path: "/", type: "layout" }],
      });
    }
    return npSuccessResponse(npSerializeSiteRecord(site));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
