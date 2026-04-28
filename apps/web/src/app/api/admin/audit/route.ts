import { NxForbiddenError, hasRole, isStaffMod, listAuditEvents } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!isStaffMod(user)) {
      throw new NxForbiddenError("audit", "read");
    }

    const params = request.nextUrl.searchParams;
    const targetType = params.get("targetType")?.trim();
    const targetId = params.get("targetId")?.trim();
    const actorUserId = params.get("actorUserId")?.trim();
    const actorMemberId = params.get("actorMemberId")?.trim();
    const action = params.get("action")?.trim();
    const sinceRaw = params.get("since");
    const untilRaw = params.get("until");
    const since = sinceRaw ? new Date(sinceRaw) : null;
    const until = untilRaw ? new Date(untilRaw) : null;
    const validSince = since && !Number.isNaN(since.getTime()) ? since : undefined;
    const validUntil = until && !Number.isNaN(until.getTime()) ? until : undefined;
    const limit = parsePositiveInt(params.get("limit"), 50, 200);
    const page = parsePositiveInt(params.get("page"), 1, 10_000);
    const offset = (page - 1) * limit;

    // Phase 17 — site scope. By default `listAuditEvents`
    // filters to the current request's site (resolved by
    // the multi-site proxy). Admin-role users can pin a
    // specific site (`siteId=<id>`) or skip the filter
    // entirely (`siteId=all`) for super-admin cross-tenant
    // triage. Mods stay confined to their current site.
    const rawSiteFilter = params.get("siteId")?.trim();
    let siteIdFilter: string | null | undefined;
    if (rawSiteFilter && hasRole(user, "admin")) {
      siteIdFilter = rawSiteFilter === "all" ? null : rawSiteFilter;
    }

    const result = await listAuditEvents({
      targetType: targetType || undefined,
      targetId: targetId || undefined,
      actorUserId: actorUserId || undefined,
      actorMemberId: actorMemberId || undefined,
      action: action || undefined,
      ...(validSince ? { since: validSince } : {}),
      ...(validUntil ? { until: validUntil } : {}),
      ...(siteIdFilter !== undefined ? { siteId: siteIdFilter } : {}),
      limit,
      offset,
    });

    const totalPages = result.totalDocs === 0 ? 0 : Math.ceil(result.totalDocs / limit);

    return nxSuccessResponse({
      docs: result.events,
      totalDocs: result.totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && result.totalDocs > 0,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
