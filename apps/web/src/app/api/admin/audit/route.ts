import {
  NX_DEFAULT_SITE_ID,
  NxForbiddenError,
  hasRoleOnSite,
  isSuperAdmin,
  listAuditEvents,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
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
    // the multi-site proxy).
    //
    // Issue #216 — `siteId=all` is super-admin only. The
    // original gate was `can(user, "admin.manage")` which let any
    // global admin enumerate cross-tenant audit data, even
    // tenants they had no membership on. A specific
    // `siteId=<id>` other than the user's accessible set is
    // also rejected so a per-site admin can't probe foreign
    // tenants through this endpoint.
    const rawSiteFilter = params.get("siteId")?.trim();
    let siteIdFilter: string | null | undefined;
    if (rawSiteFilter) {
      const superAdmin = await isSuperAdmin(user);
      if (rawSiteFilter === "all") {
        if (!superAdmin) {
          throw new NxForbiddenError("audit", "cross-site");
        }
        siteIdFilter = null;
      } else if (superAdmin) {
        siteIdFilter = rawSiteFilter;
      } else if (
        rawSiteFilter === NX_DEFAULT_SITE_ID &&
        can(user, "admin.manage")
      ) {
        // Single-tenant compatibility: a global admin without
        // any explicit memberships keeps audit access on the
        // default site.
        siteIdFilter = rawSiteFilter;
      } else if (await hasRoleOnSite(user, "moderator", rawSiteFilter)) {
        // Per-site mod-or-above can read their own site's audit.
        siteIdFilter = rawSiteFilter;
      } else {
        throw new NxForbiddenError("audit", "cross-site");
      }
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
