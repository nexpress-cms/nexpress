import {
  NxForbiddenError,
  NxValidationError,
  hasRole,
  nxNavigation,
} from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { optionalAuth, requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNavItem(value: unknown): value is NxNavItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.type === "link" || value.type === "collection" || value.type === "page") &&
    (value.children === undefined ||
      (Array.isArray(value.children) && value.children.every(isNavItem)))
  );
}

export async function GET(request: NextRequest) {
  try {
    await optionalAuth(request);

    const location = request.nextUrl.searchParams.get("location") ?? "main";
    const db = getDb();
    const [row] = await db
      .select()
      .from(nxNavigation)
      .where(eq(nxNavigation.location, location))
      .limit(1);

    return nxSuccessResponse(row ?? { location, items: [] });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("navigation", "update");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const items = body.items;
    const location =
      typeof body.location === "string" && body.location.trim()
        ? body.location.trim()
        : "main";

    if (!Array.isArray(items) || !items.every(isNavItem)) {
      throw new NxValidationError("Invalid input", [
        { field: "items", message: "items must be a valid navigation item array" },
      ]);
    }

    const db = getDb();
    const now = new Date();

    const [result] = await db
      .insert(nxNavigation)
      .values({
        location,
        items,
        updatedAt: now,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: nxNavigation.location,
        set: { items, updatedAt: now, updatedBy: user.id },
      })
      .returning();

    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
