import { getCurrentSiteId, isSuperAdmin, listSites } from "@nexpress/core";
import { canOnSite } from "@nexpress/core/sites";
import { NP_DEFAULT_SITE_ID, npSerializeSiteSummary } from "@nexpress/core/settings";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

/**
 * Phase 15.6 — sites the current user is allowed to operate
 * on. Drives the admin site-picker dropdown.
 *
 *   - super-admin → every site
 *   - explicit memberships → those sites
 *   - every authenticated staff user → the default site via the
 *     persisted global-role fallback
 *
 * Returns the slim summary the picker actually renders
 * (id, name, hostname, isDefault) plus an `isCurrent` flag
 * computed from the request's resolved site id.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    // This endpoint is the recovery path when a persisted active-site cookie
    // points at a site whose membership has since been revoked. Authenticate
    // globally, then derive the exact accessible set from persisted site roles.
    const user = await requireGlobalAuth(request);
    const allSites = await listSites();
    let accessible = allSites;

    const superAdmin = await isSuperAdmin(user);
    if (!superAdmin) {
      const decisions = await Promise.all(
        allSites.map(async (site) => ({
          site,
          allowed: await canOnSite(user, "site.access", site.id),
        })),
      );
      accessible = decisions.filter((entry) => entry.allowed).map((entry) => entry.site);
    }

    // Phase 15.6 — surface the resolver's current site id so
    // the picker can highlight the active entry without
    // reading the HttpOnly cookie from JavaScript.
    const currentId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    return npSuccessResponse({
      docs: accessible.map(npSerializeSiteSummary),
      isSuperAdmin: superAdmin,
      currentId,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
