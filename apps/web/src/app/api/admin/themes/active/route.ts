import {
  NX_DEFAULT_SITE_ID,
  NxForbiddenError,
  NxValidationError,
  getActiveThemeId,
  getCurrentSiteId,
  getThemeById,
  setActiveThemeId,
  can,
} from "@nexpress/core";
import { readJsonBody, themeCacheTag } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 11.4 — read/write the active theme id.
 *
 * GET reports `{ activeId }` so the admin switcher can show
 * which theme is currently in effect. Returns `null` when no
 * setting is persisted and the registry is empty; otherwise
 * always falls back to the first registered theme (matching
 * `getActiveTheme()` resilience).
 *
 * PUT takes `{ id: string }`, validates it against the
 * registry (404-equivalent if unknown), persists via
 * `setActiveThemeId`, and triggers a layout-wide revalidation
 * so the next request renders the new theme's shell + CSS.
 * Admin-only and CSRF-gated — this is a site-wide visual
 * change.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("themes/active", "read");
    }
    const activeId = await getActiveThemeId();
    return nxSuccessResponse({ activeId });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("themes/active", "update");
    }

    const body = await readJsonBody(request);
    const id =
      typeof body === "object" && body !== null && "id" in body
        ? (body as { id?: unknown }).id
        : undefined;
    if (typeof id !== "string" || id.length === 0) {
      throw new NxValidationError("Invalid input", [
        { field: "id", message: "Theme id is required" },
      ]);
    }
    if (!getThemeById(id)) {
      throw new NxValidationError("Invalid input", [
        {
          field: "id",
          message: `Unknown theme '${id}'. Register it in nexpress.config.ts first.`,
        },
      ]);
    }

    await setActiveThemeId(id, user.id);

    // Theme swap changes the rendered shell + CSS for every
    // page on the site, so the layout cache needs a full
    // bust. The /admin and /api routes don't need invalidation
    // because they don't render the theme.
    //
    // Wrapped in try/catch because `revalidateTag` /
    // `revalidatePath` throw "Invariant: static generation
    // store missing" when called outside Next.js's request
    // context (integration tests, scripts). The persistence
    // already succeeded; cache bust failure shouldn't surface
    // as a 500.
    try {
      const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
      const { revalidatePath, revalidateTag } = await import("next/cache");
      revalidateTag(themeCacheTag(siteId), "default");
      revalidatePath("/", "layout");
    } catch {
      // ignore — see comment above
    }

    return nxSuccessResponse({ activeId: id });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export { PUT as PATCH };

export const dynamic = "force-dynamic";
