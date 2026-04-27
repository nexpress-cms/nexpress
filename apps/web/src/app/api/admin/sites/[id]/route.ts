import {
  NxForbiddenError,
  NxValidationError,
  deleteSite,
  getSiteById,
  hasRole,
  updateSite,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 15.3 — per-site admin endpoints.
 *
 *   GET    /api/admin/sites/{id}    read one site
 *   PATCH  /api/admin/sites/{id}    update name / hostname / description
 *   DELETE /api/admin/sites/{id}    delete (default site is refused by
 *                                   the registry layer)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("sites", "read");
    }
    const { id } = await context.params;
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
    requireCsrf(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("sites", "update");
    }
    const { id } = await context.params;
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
    requireCsrf(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("sites", "delete");
    }
    const { id } = await context.params;
    await deleteSite(id);
    return nxSuccessResponse({ id, deleted: true });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
