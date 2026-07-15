import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  getCurrentSiteId,
  isSuperAdmin,
} from "@nexpress/core";
import { listAuditEvents } from "@nexpress/core/community";
import {
  npRequireAuditPageWire,
  npRequireCommunityTimestamp,
  npToAuditEventWireRow,
} from "@nexpress/core/community-contract";
import { canOnSite } from "@nexpress/core/sites";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { requireAuth } from "../../../lib/auth-helpers";
import { ensureFor } from "../../../lib/init-core";
import { npReadCommunityPage, npRequireCommunityRequest } from "../../../lib/community-contract";

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
    const since = sinceRaw
      ? new Date(
          npRequireCommunityRequest(
            (value) => npRequireCommunityTimestamp(value, "community.audit.since"),
            sinceRaw,
          ),
        )
      : undefined;
    const until = untilRaw
      ? new Date(
          npRequireCommunityRequest(
            (value) => npRequireCommunityTimestamp(value, "community.audit.until"),
            untilRaw,
          ),
        )
      : undefined;
    const { limit, page, offset } = npReadCommunityPage(params);

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
    // Issue #379 — explicit `siteId=<id>` requests use the canonical
    // site capability contract. Non-default tenants require an explicit
    // membership, while the reserved default site may use the global role.
    const rawSiteFilter = params.get("siteId")?.trim();
    let siteIdFilter: string | null | undefined;
    if (rawSiteFilter) {
      const superAdmin = await isSuperAdmin(user);
      if (rawSiteFilter === "all") {
        if (!superAdmin) {
          throw new NpForbiddenError("audit", "cross-site");
        }
        siteIdFilter = null;
      } else if (await canOnSite(user, "community.moderate", rawSiteFilter)) {
        // The canonical persisted-role chain covers super-admin,
        // explicit membership, and the default-only global fallback.
        siteIdFilter = rawSiteFilter;
      } else {
        throw new NpForbiddenError("audit", "cross-site");
      }
    } else {
      // Implicit "current site" path. Authorize against the
      // resolved request site, not via a global pre-check —
      // a per-site moderator with no global role still needs
      // to be able to read their own tenant's audit log.
      // Issue #379 — `canOnSite` requires explicit membership for
      // non-default sites, so a global moderator
      // without a tenant membership can't read another tenant's
      // audit log when the proxy resolves a non-default site.
      const currentSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
      if (!(await canOnSite(user, "community.moderate", currentSiteId))) {
        throw new NpForbiddenError("audit", "read");
      }
    }

    const result = await listAuditEvents({
      targetType: targetType || undefined,
      targetId: targetId || undefined,
      actorUserId: actorUserId || undefined,
      actorMemberId: actorMemberId || undefined,
      action: action || undefined,
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
      ...(siteIdFilter !== undefined ? { siteId: siteIdFilter } : {}),
      limit,
      offset,
    });

    const totalPages = result.totalDocs === 0 ? 0 : Math.ceil(result.totalDocs / limit);

    return npSuccessResponse(
      npRequireAuditPageWire({
        docs: result.events.map(npToAuditEventWireRow),
        totalDocs: result.totalDocs,
        totalPages,
        page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1 && result.totalDocs > 0,
      }),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
