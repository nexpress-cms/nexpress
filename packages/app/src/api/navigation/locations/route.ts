import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  can,
  getActiveThemeNavLocations,
  getCurrentSiteId,
  npNavigation,
} from "@nexpress/core";
import {
  npAnalyzeNavigationItems,
  npAnalyzeNavigationLocation,
  type NpNavItem,
} from "@nexpress/core/navigation";
import { eq } from "drizzle-orm";

import { requireAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";
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
  /** Phase F.6.1 — total item count (top-level + children) for
   *  this location, or `0` when no row exists yet. Drives the
   *  "Empty" badge + maxItems warning in the assignments panel. */
  itemCount: number;
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
  { value: "header", label: "Header", source: "default", itemCount: 0 },
  { value: "footer", label: "Footer", source: "default", itemCount: 0 },
  { value: "main", label: "Main", source: "default", itemCount: 0 },
];

/** Recursively count nav items (top-level + nested children).
 *  Children are bounded to a single level by the editor today, but
 *  walk recursively so the count stays correct if depth grows. */
function countNavItems(items: NpNavItem[] | null | undefined): number {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const item of items) {
    total += 1;
    if (Array.isArray(item.children)) {
      total += countNavItems(item.children);
    }
  }
  return total;
}

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
    // Phase F.6.1 — pull `items` alongside `location` so the
    // assignments panel can show "X items" / "Empty" / "over
    // limit" without a follow-up round trip per location.
    const rows = await db
      .select({ location: npNavigation.location, items: npNavigation.items })
      .from(npNavigation)
      .where(eq(npNavigation.siteId, siteId));

    const countByLocation = new Map<string, number>();
    for (const row of rows) {
      const issues = [
        ...npAnalyzeNavigationLocation(row.location).map((entry) => ({
          field: entry.path.replace(/^navigation\.location/u, `navigation.${row.location}`),
          message: entry.message,
        })),
        ...npAnalyzeNavigationItems(row.items).map((entry) => ({
          field: entry.path.replace(/^navigation\.items/u, `navigation.${row.location}`),
          message: entry.message,
        })),
      ];
      if (issues.length > 0) {
        throw new NpValidationError("Invalid stored navigation", issues);
      }
      countByLocation.set(row.location, countNavItems(row.items));
    }

    // Phase F.6 — pull theme-declared nav locations into the
    // editor's dropdown so operators see friendly labels (and
    // descriptions / maxItems hints) for the slots their active
    // theme actually consumes. Theme-declared keys win on
    // collision with framework defaults so e.g. magazine can
    // relabel "header" → "Site Header".
    const themeLocations = await getActiveThemeNavLocations();

    const byKey = new Map<string, LocationOption>();
    for (const def of DEFAULT_LOCATIONS) {
      byKey.set(def.value, { ...def, itemCount: countByLocation.get(def.value) ?? 0 });
    }
    for (const t of themeLocations) {
      byKey.set(t.key, {
        value: t.key,
        label: t.label,
        description: t.description,
        maxItems: t.maxItems,
        source: "theme",
        itemCount: countByLocation.get(t.key) ?? 0,
      });
    }
    for (const row of rows) {
      if (byKey.has(row.location)) continue;
      byKey.set(row.location, {
        value: row.location,
        label: titleCase(row.location),
        source: "custom",
        itemCount: countByLocation.get(row.location) ?? 0,
      });
    }

    return npSuccessResponse({ locations: [...byKey.values()] });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}
