import {
  NP_DEFAULT_SITE_ID,
  NpValidationError,
  getCurrentSiteId,
  npNavigation,
} from "@nexpress/core";
import {
  npAnalyzeNavigationItems,
  npAnalyzeNavigationLocation,
  type NpNavItem,
} from "@nexpress/core/navigation";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { optionalAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";

interface MembershipRow {
  location: string;
  itemId: string;
  label: string;
}

/**
 * Reports every navigation row across the current site that
 * references the given pageId — used by the page edit-view's
 * "In navigation" panel so the editor can show where this page
 * already appears, and add/remove it without leaving the page.
 *
 * Scans `items` JSONB recursively (nested children supported by
 * the editor as of #431). Returns one row per match with the
 * surrounding nav item's id + label so the caller can identify
 * the existing entry without re-walking the JSON.
 *
 * Designed for forward-compat with user-defined nav locations:
 * we don't enumerate a fixed location list — we just return what
 * actually exists in the DB for this site.
 */
export async function GET(request: NextRequest) {
  try {
    await optionalAuth(request);

    const pageId = request.nextUrl.searchParams.get("pageId");
    if (!pageId) {
      throw new NpValidationError("Invalid query parameters", [
        { field: "pageId", message: "pageId is required" },
      ]);
    }
    // Source collection of the doc whose memberships we're listing.
    // Defaults to `"pages"` so panel calls from the reference pages
    // collection (and any pre-#440 client that doesn't send the
    // param yet) keep their existing behavior.
    const collection = request.nextUrl.searchParams.get("collection")?.trim() || "pages";

    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const rows = await db.select().from(npNavigation).where(eq(npNavigation.siteId, siteId));

    const memberships: MembershipRow[] = [];
    for (const row of rows) {
      const issues = [
        ...npAnalyzeNavigationLocation(row.location).map((entry) => ({
          ...entry,
          path: entry.path.replace(/^navigation\.location/u, `navigation.${row.location}`),
        })),
        ...npAnalyzeNavigationItems(row.items).map((entry) => ({
          ...entry,
          path: entry.path.replace(/^navigation/u, `navigation.${row.location}`),
        })),
      ];
      if (issues.length > 0) {
        throw new NpValidationError(
          "Invalid stored navigation",
          issues.map((entry) => ({
            field: entry.path,
            message: entry.message,
          })),
        );
      }
      walk(row.items, row.location, pageId, collection, memberships);
    }

    return npSuccessResponse({ memberships });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function walk(
  items: NpNavItem[] | null | undefined,
  location: string,
  pageId: string,
  collection: string,
  out: MembershipRow[],
): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    // Default the per-item collection to "pages" — matches the
    // resolver in @nexpress/core/content/helpers.ts and the wire
    // format guarantee.
    const itemCollection = item.collectionSlug ?? "pages";
    if (item.type === "page" && item.pageId === pageId && itemCollection === collection) {
      out.push({ location, itemId: item.id, label: item.label });
    }
    if (item.children) walk(item.children, location, pageId, collection, out);
  }
}
