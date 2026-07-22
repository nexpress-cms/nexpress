import {
  NpForbiddenError,
  NpValidationError,
  getOptionalJobQueue,
  getSiteQuotaSnapshot,
  isSuperAdmin,
  setSiteQuotas,
} from "@nexpress/core";
import { getSiteQuotaJobTypes } from "@nexpress/core/jobs";
import { npNormalizeSiteQuotas } from "@nexpress/core/settings";
import { canOnSite } from "@nexpress/core/sites";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

function jobUsageReader() {
  const queue = getOptionalJobQueue();
  const countSiteEnqueues = queue?.countSiteEnqueues?.bind(queue);
  if (!queue || !countSiteEnqueues) return undefined;
  const types = getSiteQuotaJobTypes();
  return (siteId: string, since: Date) => countSiteEnqueues(siteId, since, types);
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const { id } = await context.params;
    if (!(await canOnSite(user, "admin.manage", id))) {
      throw new NpForbiddenError("sites/quotas", "read");
    }
    return npSuccessResponse(await getSiteQuotaSnapshot(id, jobUsageReader()));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!(await isSuperAdmin(user))) {
      throw new NpForbiddenError("sites/quotas", "update");
    }
    const { id } = await context.params;
    let quotas;
    try {
      quotas = npNormalizeSiteQuotas(await readJsonBody(request));
    } catch (error) {
      throw new NpValidationError("Invalid site quotas", [
        {
          field: "quotas",
          message: error instanceof Error ? error.message : "Invalid site quotas",
        },
      ]);
    }
    await setSiteQuotas(quotas, user.id, id);
    return npSuccessResponse(await getSiteQuotaSnapshot(id, jobUsageReader()));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
