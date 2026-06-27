import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  can,
  getCurrentSiteId,
  getPluginConfigWithStatus,
  getPluginRegistration,
  introspectThemeSettingsSchema,
  pluginConfigCacheTag,
  setPluginConfig,
} from "@nexpress/core";
import { invalidateCacheTargets, readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

/**
 * G.1 — per-plugin operator config.
 *
 * GET returns `{ fields, value, hasPersisted, parseError? }`. The
 * `fields` payload is the introspected metadata from the plugin's
 * `configSchema` (same shape theme settings emits via F.3); the admin
 * auto-form consumes it directly without needing zod in the browser.
 *
 * PUT validates the body via the schema, persists at
 * `np_settings (siteId, "plugin.config:<pluginId>")`, and busts the
 * `np:plugin:<pluginId>` cache tag.
 */

interface RouteContext {
  params: Promise<{ pluginId: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins/config", "read");
    }
    const { pluginId } = await ctx.params;
    const reg = getPluginRegistration(pluginId);
    if (!reg) {
      throw new NpValidationError("Invalid input", [
        { field: "pluginId", message: `Unknown plugin '${pluginId}'.` },
      ]);
    }
    if (!reg.configSchema) {
      // No auto-form for this plugin — admin renders any
      // legacy `admin.settings.fields` panel instead. Surface a
      // clear empty state so the client doesn't have to guess.
      return npSuccessResponse({
        pluginId,
        fields: [],
        value: {},
        hasPersisted: false,
      });
    }
    const fields = introspectThemeSettingsSchema(
      reg.configSchema as Parameters<typeof introspectThemeSettingsSchema>[0],
    );
    const status = await getPluginConfigWithStatus(pluginId);
    return npSuccessResponse({
      pluginId,
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
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins/config", "update");
    }
    const { pluginId } = await ctx.params;
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

    const persisted = await setPluginConfig(pluginId, value, user.id);

    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    invalidateCacheTargets({
      source: "plugin-config",
      siteId,
      pluginId,
      tags: [pluginConfigCacheTag(pluginId)],
    });

    return npSuccessResponse({ pluginId, value: persisted });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown"));
  }
}

export const dynamic = "force-dynamic";
