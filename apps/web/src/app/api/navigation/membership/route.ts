import {
  NX_DEFAULT_SITE_ID,
  NxValidationError,
  getCurrentSiteId,
  nxNavigation,
} from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { optionalAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

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
      throw new NxValidationError("Invalid query parameters", [
        { field: "pageId", message: "pageId is required" },
      ]);
    }

    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
    const rows = await db.select().from(nxNavigation).where(eq(nxNavigation.siteId, siteId));

    const memberships: MembershipRow[] = [];
    for (const row of rows) {
      walk(row.items, row.location, pageId, memberships);
    }

    return nxSuccessResponse({ memberships });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function walk(
  items: NxNavItem[] | null | undefined,
  location: string,
  pageId: string,
  out: MembershipRow[],
): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item.type === "page" && item.pageId === pageId) {
      out.push({ location, itemId: item.id, label: item.label });
    }
    if (item.children) walk(item.children, location, pageId, out);
  }
}
