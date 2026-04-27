import {
  NxForbiddenError,
  NxValidationError,
  createSite,
  hasRole,
  listSites,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Phase 15.3 — multi-site admin endpoints.
 *
 *   GET  /api/admin/sites           list every site
 *   POST /api/admin/sites           create a site
 *
 * Both gated to admin-or-above. v1 uses the existing global
 * admin role; the per-site role tier (15.5) will replace this
 * with a super-admin gate so per-site admins can't elevate to
 * site management for other tenants.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("sites", "list");
    }
    const sites = await listSites();
    return nxSuccessResponse({ docs: sites });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    requireCsrf(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("sites", "create");
    }
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null) {
      throw new NxValidationError("Invalid input", [
        { field: "body", message: "Request body must be an object" },
      ]);
    }
    const { id, name, hostname, description } = body as {
      id?: unknown;
      name?: unknown;
      hostname?: unknown;
      description?: unknown;
    };
    if (typeof id !== "string" || !id) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: "id is required" },
      ]);
    }
    if (typeof name !== "string" || !name) {
      throw new NxValidationError("Invalid input", [
        { field: "name", message: "name is required" },
      ]);
    }
    const site = await createSite({
      id,
      name,
      hostname: typeof hostname === "string" ? hostname : null,
      description: typeof description === "string" ? description : null,
    });
    return nxSuccessResponse(site);
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
