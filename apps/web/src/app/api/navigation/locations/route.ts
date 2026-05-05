import {
  NX_DEFAULT_SITE_ID,
  NpForbiddenError,
  can,
  getCurrentSiteId,
  npNavigation,
} from "@nexpress/core";
import { eq } from "drizzle-orm";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import type { NextRequest } from "next/server";

interface LocationOption {
  value: string;
  label: string;
}

/**
 * Lists every navigation location available to this site.
 *
 * Two sources, merged:
 *
 *   1. Three "well-known" defaults (`header` / `footer` / `main`)
 *      that themes consume out of the box. Always present in the
 *      list — even if no rows exist for them yet — so the editor
 *      can offer them to first-time setups.
 *   2. Any extra locations the operator has created via the
 *      editor (saving a nav at a custom location string spawns a
 *      new `nx_navigation` row, which shows up here on the next
 *      load).
 *
 * Labels default to a Title-Case version of the slug for display.
 * Future enhancement: separate `nx_nav_locations` table with
 * proper labels + ordering. The editor can switch over without
 * the response shape changing.
 */
const DEFAULT_LOCATIONS: LocationOption[] = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "main", label: "Main" },
];

export async function GET(request: NextRequest) {
  try {
    // Admin-only — this endpoint reveals every nav location slug,
    // including custom ones the operator may not want crawled. The
    // public site reads navs by slug name (which the theme already
    // knows), so anonymous traffic has no reason to enumerate.
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("navigation", "list-locations");
    }

    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
    const rows = await db
      .select({ location: npNavigation.location })
      .from(npNavigation)
      .where(eq(npNavigation.siteId, siteId));

    const seen = new Set(DEFAULT_LOCATIONS.map((l) => l.value));
    const locations: LocationOption[] = [...DEFAULT_LOCATIONS];
    for (const row of rows) {
      if (seen.has(row.location)) continue;
      seen.add(row.location);
      locations.push({ value: row.location, label: titleCase(row.location) });
    }

    return npSuccessResponse({ locations });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
