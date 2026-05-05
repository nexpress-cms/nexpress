import {
  NX_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  getCurrentSiteId,
  npSettings,
  DEFAULT_THEME,
  can,
} from "@nexpress/core";
import type { NpThemeTokens } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidTheme(value: unknown): value is NpThemeTokens {
  return (
    isRecord(value) && isRecord(value.colors) && isRecord(value.typography) && isRecord(value.shape)
  );
}

export async function GET(_request: NextRequest) {
  try {
    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
    const [row] = await db
      .select()
      .from(npSettings)
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "theme")))
      .limit(1);

    return npSuccessResponse(row?.value ?? DEFAULT_THEME);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("settings/theme", "update");
    }

    const theme = await readJsonBody(request);

    if (!isValidTheme(theme)) {
      throw new NpValidationError("Invalid input", [
        { field: "theme", message: "Theme must have colors, typography, and shape objects" },
      ]);
    }

    const db = getDb();
    const now = new Date();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;

    await db
      .insert(npSettings)
      .values({ siteId, key: "theme", value: theme, updatedAt: now, updatedBy: user.id })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value: theme, updatedAt: now, updatedBy: user.id },
      });

    // Phase 14.3 — site-scoped tag matches the cache helpers
    // in `@nexpress/next` (`themeCacheTag(siteId)`). Tenants
    // editing their own theme don't bust unrelated sites'
    // caches. The path revalidation stays scoped to the layout
    // so any cached SSR output downstream also drops.
    try {
      const { revalidatePath, revalidateTag } = await import("next/cache");
      const { themeCacheTag } = await import("@nexpress/next");
      revalidateTag(themeCacheTag(siteId), "default");
      revalidatePath("/", "layout");
    } catch {
      // Swallow — see active-theme route's matching catch.
    }

    return npSuccessResponse(theme);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export { PUT as PATCH };
