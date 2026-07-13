import {
  NpForbiddenError,
  NpValidationError,
  getSiteById,
  grantSiteMembership,
  listSiteMemberships,
} from "@nexpress/core";
import { canOnSite } from "@nexpress/core/sites";
import { readJsonBody } from "@nexpress/next";
import {
  npNormalizeSiteMembershipGrantInput,
  npSerializeSiteMembership,
} from "@nexpress/core/settings";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

    if (!(await canOnSite(user, "admin.manage", id))) {
      throw new NpForbiddenError("memberships", "list");
    }

    const memberships = await listSiteMemberships(id);
    return npSuccessResponse({ docs: memberships.map(npSerializeSiteMembership) });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

    if (!(await canOnSite(user, "admin.manage", id))) {
      throw new NpForbiddenError("memberships", "create");
    }

    const body = await readJsonBody(request);
    let input: ReturnType<typeof npNormalizeSiteMembershipGrantInput>;
    try {
      input = npNormalizeSiteMembershipGrantInput(body);
    } catch (error) {
      throw new NpValidationError("Invalid input", [
        {
          field: "membership",
          message: error instanceof Error ? error.message : "Invalid membership",
        },
      ]);
    }
    const membership = await grantSiteMembership(id, input.userId, input.role);
    return npSuccessResponse(npSerializeSiteMembership(membership));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
