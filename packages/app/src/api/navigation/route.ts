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
import type { NpNavItem } from "@nexpress/core";
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

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function bustNavCache(siteId: string, location: string): void {
  invalidateCacheTargets({
    source: "navigation",
    siteId,
    navigationLocation: location,
    tags: [navCacheTag(siteId, location)],
  });
}

function isNavItem(value: unknown): value is NpNavItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.type === "link" || value.type === "collection" || value.type === "page") &&
    // collectionSlug is optional; when present, it scopes a `page`-
    // typed item to a non-`pages` collection.
    (value.collectionSlug === undefined || typeof value.collectionSlug === "string") &&
    (value.children === undefined ||
      (Array.isArray(value.children) && value.children.every(isNavItem)))
  );
}

export async function GET(request: NextRequest) {
  try {
    await optionalAuth(request);

    const location = request.nextUrl.searchParams.get("location") ?? "main";
    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const [row] = await db
      .select()
      .from(npNavigation)
      .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, location)))
      .limit(1);

    return npSuccessResponse(row ?? { location, items: [] });
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

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const items = body.items;
    const location =
      typeof body.location === "string" && body.location.trim() ? body.location.trim() : "main";
    // Optimistic concurrency token. Clients that loaded the row
    // pass back the `updatedAt` they got from GET; if it doesn't
    // match what's currently in the DB, another writer has landed
    // a save in between and we 409 instead of silently clobbering.
    // Omitting the token preserves the legacy last-write-wins
    // semantics for back-compat (server-side scripts, older
    // admin builds).
    const expectedUpdatedAt =
      typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null;

    if (!Array.isArray(items) || !items.every(isNavItem)) {
      throw new NpValidationError("Invalid input", [
        { field: "items", message: "items must be a valid navigation item array" },
      ]);
    }

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
        items,
        updatedAt: now,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [npNavigation.siteId, npNavigation.location],
        set: { items, updatedAt: now, updatedBy: user.id },
      })
      .returning();

    // Phase 14.3 — bust the per-(site, location) cache key set
    // up by `getCachedNavigation` so theme headers/footers
    // pick up the edit on the next render.
    bustNavCache(siteId, location);

    return npSuccessResponse(result);
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

    const location = request.nextUrl.searchParams.get("location")?.trim();
    if (!location) {
      throw new NpValidationError("Invalid input", [
        { field: "location", message: "location query param is required" },
      ]);
    }
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

    bustNavCache(siteId, location);

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

    const oldLocation = request.nextUrl.searchParams.get("location")?.trim();
    if (!oldLocation) {
      throw new NpValidationError("Invalid input", [
        { field: "location", message: "location query param is required" },
      ]);
    }
    if (PROTECTED_LOCATIONS.has(oldLocation)) {
      throw new NpForbiddenError("navigation", "rename-default-location");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const newLocation =
      typeof body.newLocation === "string" ? body.newLocation.trim().toLowerCase() : "";

    if (!newLocation || !SLUG_RE.test(newLocation)) {
      throw new NpValidationError("Invalid input", [
        {
          field: "newLocation",
          message: "newLocation must be lowercase letters, numbers, or hyphens",
        },
      ]);
    }
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

    bustNavCache(siteId, oldLocation);
    bustNavCache(siteId, newLocation);

    return npSuccessResponse(renamed);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
