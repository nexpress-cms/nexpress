import {
  NX_DEFAULT_SITE_ID,
  getCurrentSiteId,
  nxNavigation,
} from "@nexpress/core";
import { eq } from "drizzle-orm";

import { optionalAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
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

export async function GET(_request: NextRequest) {
  try {
    await optionalAuth(_request);

    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
    const rows = await db
      .select({ location: nxNavigation.location })
      .from(nxNavigation)
      .where(eq(nxNavigation.siteId, siteId));

    const seen = new Set(DEFAULT_LOCATIONS.map((l) => l.value));
    const locations: LocationOption[] = [...DEFAULT_LOCATIONS];
    for (const row of rows) {
      if (seen.has(row.location)) continue;
      seen.add(row.location);
      locations.push({ value: row.location, label: titleCase(row.location) });
    }

    return nxSuccessResponse({ locations });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
