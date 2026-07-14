import {
  NP_DEFAULT_SITE_ID,
  NpConflictError,
  NpForbiddenError,
  NpNotFoundError,
  NpValidationError,
  getCurrentSiteId,
  npNavigation,
  can,
} from "@nexpress/core";
import {
  npAnalyzeNavigationItems,
  npAnalyzeNavigationLocation,
  type NpNavigationContractIssue,
  type NpNavItem,
} from "@nexpress/core/navigation";
import { invalidateCacheTargets, navCacheTag, readJsonBody } from "@nexpress/next";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { optionalAuth, requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { getDb } from "../../lib/db";

// Theme-baked default locations. Operators can edit their items
// but not rename or delete the slot itself — themes look these up
// by name and would silently render nothing if the slug moved.
const PROTECTED_LOCATIONS = new Set(["header", "footer", "main"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function bustNavCache(siteId: string, location: string) {
  return invalidateCacheTargets({
    source: "navigation",
    siteId,
    navigationLocation: location,
    tags: [navCacheTag(siteId, location)],
  });
}

function throwNavigationIssues(
  issues: readonly NpNavigationContractIssue[],
  message = "Invalid input",
  storedLocation?: string,
): void {
  if (issues.length === 0) return;
  throw new NpValidationError(
    message,
    issues.map((entry) => ({
      field: storedLocation
        ? entry.path.replace(/^navigation/u, `navigation.${storedLocation}`)
        : entry.path.replace(/^navigation\./u, ""),
      message: entry.message,
    })),
  );
}

function rejectUnknownBodyFields(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  const key = Object.keys(body).find((entry) => !allowed.has(entry));
  if (key) {
    throw new NpValidationError("Invalid input", [
      { field: key, message: `unsupported navigation request field "${key}"` },
    ]);
  }
}

function isCanonicalIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export async function GET(request: NextRequest) {
  try {
    await optionalAuth(request);

    const location = request.nextUrl.searchParams.get("location") ?? "main";
    throwNavigationIssues(npAnalyzeNavigationLocation(location));
    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const [row] = await db
      .select()
      .from(npNavigation)
      .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, location)))
      .limit(1);

    if (row) {
      throwNavigationIssues(
        npAnalyzeNavigationItems(row.items),
        "Invalid stored navigation",
        location,
      );
    }
    return npSuccessResponse(
      row
        ? { location: row.location, items: row.items, updatedAt: row.updatedAt.toISOString() }
        : { location, items: [], updatedAt: null },
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("navigation", "update");
    }

    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new NpValidationError("Invalid input", [
        { field: "body", message: "Request body must be a JSON object" },
      ]);
    }
    rejectUnknownBodyFields(body, new Set(["location", "items", "expectedUpdatedAt"]));
    const items = body.items;
    const rawLocation = Object.hasOwn(body, "location") ? body.location : "main";
    // Optimistic concurrency token. Clients that loaded the row
    // pass back the `updatedAt` they got from GET; if it doesn't
    // match what's currently in the DB, another writer has landed
    // a save in between and we 409 instead of silently clobbering.
    // Omitting the token preserves the legacy last-write-wins
    // semantics for back-compat (server-side scripts, older
    // admin builds).
    const expectedUpdatedAt = isCanonicalIsoDateTime(body.expectedUpdatedAt)
      ? body.expectedUpdatedAt
      : null;
    if (Object.hasOwn(body, "expectedUpdatedAt") && expectedUpdatedAt === null) {
      throw new NpValidationError("Invalid input", [
        {
          field: "expectedUpdatedAt",
          message: "expectedUpdatedAt must be the canonical UTC date-time returned by this API",
        },
      ]);
    }

    throwNavigationIssues(npAnalyzeNavigationLocation(rawLocation));
    throwNavigationIssues(npAnalyzeNavigationItems(items));
    const location = rawLocation as string;

    const db = getDb();
    const now = new Date();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    if (expectedUpdatedAt !== null) {
      const [existing] = await db
        .select({ updatedAt: npNavigation.updatedAt })
        .from(npNavigation)
        .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, location)))
        .limit(1);
      // Row missing: legitimate first save — let the upsert below
      // create it. Row present but stale token: another writer
      // landed in between, surface the conflict.
      if (existing && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw new NpConflictError(
          "Navigation was changed by another writer. Reload to see the latest version.",
        );
      }
    }

    const [result] = await db
      .insert(npNavigation)
      .values({
        siteId,
        location,
        items: items as NpNavItem[],
        updatedAt: now,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [npNavigation.siteId, npNavigation.location],
        set: { items: items as NpNavItem[], updatedAt: now, updatedBy: user.id },
      })
      .returning();

    // Phase 14.3 — bust the per-(site, location) cache key set
    // up by `getCachedNavigation` so theme headers/footers
    // pick up the edit on the next render.
    await bustNavCache(siteId, location);

    return npSuccessResponse({
      location: result.location,
      items: result.items,
      updatedAt: result.updatedAt.toISOString(),
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("navigation", "delete");
    }

    const location = request.nextUrl.searchParams.get("location");
    if (!location) {
      throw new NpValidationError("Invalid input", [
        { field: "location", message: "location query param is required" },
      ]);
    }
    throwNavigationIssues(npAnalyzeNavigationLocation(location));
    if (PROTECTED_LOCATIONS.has(location)) {
      throw new NpForbiddenError("navigation", "delete-default-location");
    }

    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    const deleted = await db
      .delete(npNavigation)
      .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, location)))
      .returning({ location: npNavigation.location });

    if (deleted.length === 0) {
      throw new NpNotFoundError("navigation", location);
    }

    await bustNavCache(siteId, location);

    return npSuccessResponse({ location });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("navigation", "rename");
    }

    const oldLocation = request.nextUrl.searchParams.get("location");
    if (!oldLocation) {
      throw new NpValidationError("Invalid input", [
        { field: "location", message: "location query param is required" },
      ]);
    }
    throwNavigationIssues(npAnalyzeNavigationLocation(oldLocation));
    if (PROTECTED_LOCATIONS.has(oldLocation)) {
      throw new NpForbiddenError("navigation", "rename-default-location");
    }

    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new NpValidationError("Invalid input", [
        { field: "body", message: "Request body must be a JSON object" },
      ]);
    }
    rejectUnknownBodyFields(body, new Set(["newLocation"]));
    const rawNewLocation = body.newLocation;

    const newLocationIssues = npAnalyzeNavigationLocation(rawNewLocation).map((entry) => ({
      ...entry,
      path: "navigation.newLocation",
    }));
    throwNavigationIssues(newLocationIssues);
    const newLocation = rawNewLocation as string;
    if (newLocation === oldLocation) {
      throw new NpValidationError("Invalid input", [
        { field: "newLocation", message: "newLocation must differ from current" },
      ]);
    }
    if (PROTECTED_LOCATIONS.has(newLocation)) {
      throw new NpForbiddenError("navigation", "rename-into-default-location");
    }

    const db = getDb();
    const now = new Date();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    // Conflict check before update so we get a 409 instead of a
    // bare unique-constraint violation surfacing as a 500.
    const [conflict] = await db
      .select({ id: npNavigation.id })
      .from(npNavigation)
      .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, newLocation)))
      .limit(1);
    if (conflict) {
      throw new NpConflictError(`Location "${newLocation}" already exists.`);
    }

    const [renamed] = await db
      .update(npNavigation)
      .set({ location: newLocation, updatedAt: now, updatedBy: user.id })
      .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, oldLocation)))
      .returning();

    if (!renamed) {
      throw new NpNotFoundError("navigation", oldLocation);
    }

    await bustNavCache(siteId, oldLocation);
    await bustNavCache(siteId, newLocation);

    return npSuccessResponse({
      location: renamed.location,
      items: renamed.items,
      updatedAt: renamed.updatedAt.toISOString(),
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
