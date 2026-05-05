import {
  NpForbiddenError,
  NpValidationError,
  getMembership,
  getSiteById,
  grantSiteMembership,
  isSuperAdmin,
  listSiteMemberships,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 15.6 — site memberships admin.
 *
 *   GET    /api/admin/sites/{id}/memberships
 *     → { docs: [{ siteId, userId, role, createdAt, updatedAt }, ...] }
 *
 *   POST   /api/admin/sites/{id}/memberships
 *     body: { userId, role }
 *     → 200 { siteId, userId, role, ... }
 *
 *   DELETE /api/admin/sites/{id}/memberships/{userId}
 *     → 200 { ok: true }
 *
 * Access rule: super-admins can manage memberships on any
 * site; per-site admins can manage memberships on sites they
 * already hold an `admin` membership on. Non-admins are
 * rejected.
 */

const VALID_ROLES = ["admin", "editor", "moderator", "author", "viewer"] as const;

async function assertCanManage(siteId: string, userId: string, userRole: string) {
  // super-admin path is checked outside; this helper covers
  // the per-site-admin path: caller must hold an `admin`
  // membership on the target site, OR be a global admin
  // operating on the default site (single-tenant fallback).
  if (siteId === "default" && userRole === "admin") return true;
  const membership = await getMembership(siteId, userId);
  return membership?.role === "admin";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id } = await context.params;

    const target = await getSiteById(id);
    if (!target) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }

    const superAdmin = await isSuperAdmin(user);
    if (!superAdmin && !(await assertCanManage(id, user.id, user.role))) {
      throw new NpForbiddenError("memberships", "list");
    }

    const memberships = await listSiteMemberships(id);
    return npSuccessResponse({ docs: memberships });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id } = await context.params;

    const target = await getSiteById(id);
    if (!target) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }

    const superAdmin = await isSuperAdmin(user);
    if (!superAdmin && !(await assertCanManage(id, user.id, user.role))) {
      throw new NpForbiddenError("memberships", "create");
    }

    const body = (await readJsonBody(request)) as {
      userId?: unknown;
      role?: unknown;
    };
    const userId = typeof body.userId === "string" ? body.userId : null;
    const role = typeof body.role === "string" ? body.role : null;
    if (!userId) {
      throw new NpValidationError("Invalid input", [
        { field: "userId", message: "userId is required" },
      ]);
    }
    if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
      throw new NpValidationError("Invalid input", [
        {
          field: "role",
          message: `role must be one of ${VALID_ROLES.join(", ")}`,
        },
      ]);
    }

    // Note: v1 doesn't restrict the assignable role tier
    // beyond the access checks above. Sites that want "you
    // can only assign roles ≤ your own" layer that policy
    // in a follow-up; the schema enum already constrains
    // values to the legal set.
    const membership = await grantSiteMembership(
      id,
      userId,
      role as (typeof VALID_ROLES)[number],
    );
    return npSuccessResponse(membership);
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
