import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  activeThemeContributesSeo,
  can,
  getCurrentSiteId,
  getThemeById,
  getThemeSettingsWithStatus,
  introspectThemeSettingsSchema,
  setThemeSettings,
} from "@nexpress/core";
import { invalidateCacheTargets, readJsonBody, themeCacheTag } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

/**
 * Phase F.3 — per-theme operator settings.
 *
 * GET returns `{ fields, value, hasPersisted, parseError? }`:
 *   - `fields` is the form metadata (introspected from the
 *     theme's `settingsSchema`). The admin form generator
 *     consumes this directly without needing zod in the browser.
 *   - `value` is the parsed current settings (or schema defaults
 *     when no row stored / schema mismatch).
 *
 * PUT validates the body via the schema, persists at
 * `np_settings (siteId, "theme.settings:<themeId>")`, and busts
 * the existing `nx:theme:<siteId>` cache tag (sitemap / feed
 * tags additionally if the active theme contributes SEO hooks).
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("themes/settings", "read");
    }
    const { id } = await ctx.params;
    const theme = getThemeById(id);
    if (!theme) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: `Unknown theme '${id}'.` },
      ]);
    }
    const fields = introspectThemeSettingsSchema(
      // Manifest types `settingsSchema` as `unknown` so this
      // package doesn't need zod as a direct dep; core narrows
      // back to `ZodTypeAny` at the introspection / validation
      // call sites.
      theme.manifest.settingsSchema as Parameters<typeof introspectThemeSettingsSchema>[0],
    );
    const status = await getThemeSettingsWithStatus(id);
    return npSuccessResponse({
      themeId: id,
      fields,
      value: status.value,
      hasPersisted: status.hasPersisted,
      parseError: status.parseError,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown"));
  }
}

export async function PUT(request: NextRequest, ctx: RouteContext) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("themes/settings", "update");
    }
    const { id } = await ctx.params;
    const body = await readJsonBody(request);
    const value =
      typeof body === "object" && body !== null && "value" in body
        ? (body as { value?: unknown }).value
        : undefined;
    if (value === undefined) {
      throw new NpValidationError("Invalid input", [
        { field: "value", message: "Missing `value` in request body" },
      ]);
    }

    const persisted = await setThemeSettings(id, value, user.id);

    // Cache invalidation: theme settings share the existing
    // `nx:theme:<siteId>` tag with tokens + active theme id (see
    // design doc §5.3). When the active theme contributes SEO
    // hooks (`impl.seo` declared), additionally bust the
    // sitemap/feed tags so theme-driven SEO state stays fresh.
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const tags = [themeCacheTag(siteId)];
    if (await activeThemeContributesSeo()) {
      tags.push(`nx:sitemap:${siteId}`, `nx:feed:${siteId}`);
    }
    invalidateCacheTargets({
      source: "theme-settings",
      siteId,
      themeId: id,
      tags,
    });

    return npSuccessResponse({ themeId: id, value: persisted });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown"));
  }
}

export const dynamic = "force-dynamic";
