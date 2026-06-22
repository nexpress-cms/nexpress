import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  getCurrentSiteId,
  getThemeById,
  setActiveThemeId,
  can,
} from "@nexpress/core";
import { bustThemeCache, readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { getActiveThemeState } from "../../../../lib/active-theme-state";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

/**
 * Phase 11.4 — read/write the active theme id.
 *
 * GET reports `{ activeId }` using the same fallback semantics
 * as `getActiveTheme()`, plus `{ persistedActiveId,
 * fallbackReason }` so admin surfaces can explain stale persisted
 * settings after a theme was removed from `nexpress.config.ts`.
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
      throw new NpForbiddenError("themes/active", "read");
    }
    const activeState = await getActiveThemeState();
    return npSuccessResponse({
      activeId: activeState.effectiveActiveId,
      persistedActiveId: activeState.persistedActiveId,
      fallbackReason: activeState.fallbackReason,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("themes/active", "update");
    }

    const body = await readJsonBody(request);
    const id =
      typeof body === "object" && body !== null && "id" in body
        ? (body as { id?: unknown }).id
        : undefined;
    if (typeof id !== "string" || id.length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: "Theme id is required" },
      ]);
    }
    if (!getThemeById(id)) {
      throw new NpValidationError("Invalid input", [
        {
          field: "id",
          message: `Unknown theme '${id}'. Register it in nexpress.config.ts first.`,
        },
      ]);
    }

    await setActiveThemeId(id, user.id);

    // Theme swap changes the rendered shell + CSS for every
    // page on the site, so the layout cache needs a full bust.
    // The /admin and /api routes don't need invalidation
    // because they don't render the theme. Helper swallows the
    // throw that fires outside a request context.
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    await bustThemeCache(siteId);

    return npSuccessResponse({ activeId: id });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export { PUT as PATCH };

export const dynamic = "force-dynamic";
