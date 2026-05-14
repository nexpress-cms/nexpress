import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  getCurrentSiteId,
  isSuperAdmin,
  listAuditEvents,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { requireAuth } from "../../../lib/auth-helpers";
import { ensureFor } from "../../../lib/init-core";
import { canModerateSite } from "../../../lib/site-authz";

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
    //
    // Issue #365 — authorization runs AFTER site resolution so
    // per-site moderators (whose membership exists on a tenant
    // but who don't carry a global `community.moderate` role)
    // aren't bounced by an early global precheck. Each branch
    // below carries its own authorize call against the right
    // site.
    //
    // Issue #379 — explicit `siteId=<id>` requests use
    // `canModerateSite` (explicit membership lookup), not
    // `hasRoleOnSite` whose `resolveUserRoleOnSite` falls back to
    // the user's global role when no membership exists on the
    // target site. The fallback let a global moderator/editor/admin
    // enumerate any tenant's audit log via the siteId filter. The
    // default-site path keeps the global-admin convenience for
    // single-tenant installs.
    const rawSiteFilter = params.get("siteId")?.trim();
    let siteIdFilter: string | null | undefined;
    if (rawSiteFilter) {
      const superAdmin = await isSuperAdmin(user);
      if (rawSiteFilter === "all") {
        if (!superAdmin) {
          throw new NpForbiddenError("audit", "cross-site");
        }
        siteIdFilter = null;
      } else if (superAdmin) {
        siteIdFilter = rawSiteFilter;
      } else if (
        rawSiteFilter === NP_DEFAULT_SITE_ID &&
        can(user, "admin.manage")
      ) {
        // Single-tenant compatibility: a global admin without
        // any explicit memberships keeps audit access on the
        // default site.
        siteIdFilter = rawSiteFilter;
      } else if (await canModerateSite(user, rawSiteFilter)) {
        // Per-site mod-or-above (by explicit membership) can read
        // their own site's audit.
        siteIdFilter = rawSiteFilter;
      } else {
        throw new NpForbiddenError("audit", "cross-site");
      }
    } else {
      // Implicit "current site" path. Authorize against the
      // resolved request site, not via a global pre-check —
      // a per-site moderator with no global role still needs
      // to be able to read their own tenant's audit log.
      // Issue #379 — `canModerateSite` requires explicit
      // membership for non-default sites, so a global moderator
      // without a tenant membership can't read another tenant's
      // audit log when the proxy resolves a non-default site.
      const currentSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
      if (!(await canModerateSite(user, currentSiteId))) {
        throw new NpForbiddenError("audit", "read");
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

    return npSuccessResponse({
      docs: result.events,
      totalDocs: result.totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && result.totalDocs > 0,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
