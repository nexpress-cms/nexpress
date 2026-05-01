import {
  NX_DEFAULT_SITE_ID,
  NxForbiddenError,
  NxValidationError,
  getCurrentSiteId,
  hasRole,
  nxSettings,
  DEFAULT_THEME,
} from "@nexpress/core";
import type { NxThemeTokens } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidTheme(value: unknown): value is NxThemeTokens {
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
      .from(nxSettings)
      .where(and(eq(nxSettings.siteId, siteId), eq(nxSettings.key, "theme")))
      .limit(1);

    return nxSuccessResponse(row?.value ?? DEFAULT_THEME);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("settings/theme", "update");
    }

    const theme = await readJsonBody(request);

    if (!isValidTheme(theme)) {
      throw new NxValidationError("Invalid input", [
        { field: "theme", message: "Theme must have colors, typography, and shape objects" },
      ]);
    }

    const db = getDb();
    const now = new Date();
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;

    await db
      .insert(nxSettings)
      .values({ siteId, key: "theme", value: theme, updatedAt: now, updatedBy: user.id })
      .onConflictDoUpdate({
        target: [nxSettings.siteId, nxSettings.key],
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

    return nxSuccessResponse(theme);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export { PUT as PATCH };
