import {
  NX_DEFAULT_SITE_ID,
  NxForbiddenError,
  NxValidationError,
  getSiteById,
  hasRole,
  isSuperAdmin,
  listMembershipsForUser,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 15.6 — set the admin site-picker cookie.
 *
 *   POST /api/admin/sites/active   { id: string }
 *     → 200 { id }                  cookie set, admin scope switched
 *     → 400                         unknown site id
 *     → 403                         user has no access to that site
 *
 * Access rule: super-admins can switch to any site; everyone
 * else can only switch to a site they hold a membership on
 * (or to the global-admin default site if their global role
 * is admin and they have no explicit memberships — preserves
 * single-tenant behavior).
 *
 * Cookie shape: `nx-admin-site=<id>; HttpOnly; SameSite=Lax;
 * Path=/; Secure (in prod)`. HttpOnly because client JS
 * doesn't need it; the resolver reads it server-side via the
 * request headers.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);

    const body = (await readJsonBody(request)) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : null;
    if (!id) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: "Site id is required" },
      ]);
    }

    const target = await getSiteById(id);
    if (!target) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }

    // Access check: super-admin OR explicit membership OR
    // (global admin + default site, the single-tenant
    // fallback that preserves pre-15.5 behavior). Compose
    // the predicate first so the chain reads top-down.
    const superAdmin = await isSuperAdmin(user);
    if (!superAdmin) {
      const memberships = await listMembershipsForUser(user.id);
      const hasMembership = memberships.some((m) => m.siteId === id);
      const isDefaultGlobalAdmin =
        id === NX_DEFAULT_SITE_ID && hasRole(user, "admin");
      if (!hasMembership && !isDefaultGlobalAdmin) {
        throw new NxForbiddenError("sites/active", "switch");
      }
    }

    const isProduction = process.env.NODE_ENV === "production";
    const response = nxSuccessResponse({ id });
    response.cookies.set({
      name: "nx-admin-site",
      value: id,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProduction,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

/**
 * DELETE clears the cookie (returns to host-based routing).
 */
export async function DELETE(request: NextRequest) {
  try {
    await ensureWriteReady();
    await requireAuth(request);

    const response = nxSuccessResponse({ ok: true });
    response.cookies.delete("nx-admin-site");
    return response;
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
