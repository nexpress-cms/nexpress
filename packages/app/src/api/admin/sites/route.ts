import {
  NpForbiddenError,
  NpValidationError,
  createSite,
  isSuperAdmin,
  listSites,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { npNormalizeCreateSiteInput, npSerializeSiteRecord } from "@nexpress/core/settings";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { requireAuth } from "../../../lib/auth-helpers";
import { ensureFor } from "../../../lib/init-core";

/**
 * Phase 15.3 — multi-site admin endpoints.
 *
 *   GET  /api/admin/sites           list every site
 *   POST /api/admin/sites           create a site
 *
 * Issue #216 — both endpoints are super-admin only. The
 * cross-tenant management surface should not be available to
 * per-site admins or to global-admin users without a super-admin
 * flag, otherwise tenant isolation is one missed gate away from
 * leaking. The picker dropdown reads from
 * `/api/admin/sites/accessible` which still respects per-site
 * memberships, so single-tenant operators don't lose visibility.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!(await isSuperAdmin(user))) {
      throw new NpForbiddenError("sites", "list");
    }
    const sites = await listSites();
    return npSuccessResponse({ docs: sites.map(npSerializeSiteRecord) });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!(await isSuperAdmin(user))) {
      throw new NpForbiddenError("sites", "create");
    }
    const body = await readJsonBody(request);
    let input: ReturnType<typeof npNormalizeCreateSiteInput>;
    try {
      input = npNormalizeCreateSiteInput(body);
    } catch (error) {
      throw new NpValidationError("Invalid input", [
        { field: "site", message: error instanceof Error ? error.message : "Invalid site" },
      ]);
    }
    const site = await createSite(input);
    return npSuccessResponse(npSerializeSiteRecord(site));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
