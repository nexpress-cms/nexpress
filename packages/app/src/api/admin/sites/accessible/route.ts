import {
  NP_DEFAULT_SITE_ID,
  getCurrentSiteId,
  isSuperAdmin,
  listMembershipsForUser,
  listSites,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 15.6 — sites the current user is allowed to operate
 * on. Drives the admin site-picker dropdown.
 *
 *   - super-admin → every site
 *   - explicit memberships → those sites
 *   - global admin (no memberships) → the default site only
 *     (preserves pre-15.5 single-tenant behavior so existing
 *     admin sessions still see SOMETHING in the picker)
 *
 * Returns the slim summary the picker actually renders
 * (id, name, hostname, isDefault) plus an `isCurrent` flag
 * computed from the request's resolved site id.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    const allSites = await listSites();
    let accessible = allSites;

    const superAdmin = await isSuperAdmin(user);
    if (!superAdmin) {
      const memberships = await listMembershipsForUser(user.id);
      const allowedIds = new Set(memberships.map((m) => m.siteId));
      if (can(user, "admin.manage") && allowedIds.size === 0) {
        // No explicit memberships + global admin → see the
        // default site so existing single-tenant admins
        // aren't locked out of their own picker.
        allowedIds.add(NP_DEFAULT_SITE_ID);
      }
      accessible = allSites.filter((s) => allowedIds.has(s.id));
    }

    // Phase 15.6 — surface the resolver's current site id so
    // the picker can highlight the active entry without
    // reading the HttpOnly cookie from JavaScript.
    const currentId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    return npSuccessResponse({
      docs: accessible.map((site) => ({
        id: site.id,
        name: site.name,
        hostname: site.hostname,
        isDefault: site.isDefault,
      })),
      isSuperAdmin: superAdmin,
      currentId,
    });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
