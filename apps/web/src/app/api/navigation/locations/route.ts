import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  can,
  getActiveThemeNavLocations,
  getCurrentSiteId,
  npNavigation,
} from "@nexpress/core";
import { eq } from "drizzle-orm";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";
import type { NextRequest } from "next/server";

interface LocationOption {
  value: string;
  label: string;
  description?: string;
  maxItems?: number;
  /** Where this location came from. Lets the editor distinguish
   *  framework defaults from theme-declared from operator-
   *  authored entries. */
  source: "default" | "theme" | "custom";
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
 *      new `np_navigation` row, which shows up here on the next
 *      load).
 *
 * Labels default to a Title-Case version of the slug for display.
 * Future enhancement: separate `np_nav_locations` table with
 * proper labels + ordering. The editor can switch over without
 * the response shape changing.
 */
const DEFAULT_LOCATIONS: LocationOption[] = [
  { value: "header", label: "Header", source: "default" },
  { value: "footer", label: "Footer", source: "default" },
  { value: "main", label: "Main", source: "default" },
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

    await ensureFor("read");
    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const rows = await db
      .select({ location: npNavigation.location })
      .from(npNavigation)
      .where(eq(npNavigation.siteId, siteId));

    // Phase F.6 — pull theme-declared nav locations into the
    // editor's dropdown so operators see friendly labels (and
    // descriptions / maxItems hints) for the slots their active
    // theme actually consumes. Theme-declared keys win on
    // collision with framework defaults so e.g. magazine can
    // relabel "header" → "Site Header".
    const themeLocations = await getActiveThemeNavLocations();

    const byKey = new Map<string, LocationOption>();
    for (const def of DEFAULT_LOCATIONS) byKey.set(def.value, def);
    for (const t of themeLocations) {
      byKey.set(t.key, {
        value: t.key,
        label: t.label,
        description: t.description,
        maxItems: t.maxItems,
        source: "theme",
      });
    }
    for (const row of rows) {
      if (byKey.has(row.location)) continue;
      byKey.set(row.location, {
        value: row.location,
        label: titleCase(row.location),
        source: "custom",
      });
    }

    return npSuccessResponse({ locations: [...byKey.values()] });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
