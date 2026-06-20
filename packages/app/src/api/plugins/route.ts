import {
  NpForbiddenError,
  getPluginConfigWithStatus,
  getPluginRegistration,
  introspectThemeSettingsSchema,
  listPluginStates,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins", "read");
    }

    await ensureFor("plugins");
    const states = await listPluginStates(getDb());

    // G.1 — plugin config now lives in np_settings; resolve per-plugin
    // via `getPluginConfigWithStatus` (envelope-unwrapped) so the listing
    // keeps its existing `config` field for the admin index UI while also
    // carrying configSchema metadata for the inline Configure dialog.
    const items = (
      await Promise.all(
        states.map(async (state) => {
          const reg = getPluginRegistration(state.id);
          const configStatus = await getPluginConfigWithStatus(state.id);
          const config = configStatus.value ?? {};
          const configFields = reg?.configSchema
            ? introspectThemeSettingsSchema(
                reg.configSchema as Parameters<typeof introspectThemeSettingsSchema>[0],
              )
            : null;
          return {
            id: state.id,
            name: reg?.name ?? state.id,
            version: reg?.version ?? null,
            description: reg?.description ?? null,
            capabilities: reg ? [...reg.capabilities].sort() : [],
            hooks: reg ? [...reg.hooks.keys()].sort() : [],
            routes: reg
              ? reg.routes.map((route) => ({
                  method: route.method.toUpperCase(),
                  path: route.path,
                }))
              : [],
            hasAdmin: reg?.admin !== undefined,
            // Legacy settings sub-tree (if declared). New configSchema-backed
            // plugins use `configFields` below; this remains for plugins that
            // have not migrated off `admin.settings.fields`.
            adminSettings: reg?.admin?.settings ?? null,
            // `null` means no configSchema. An empty array is meaningful:
            // the plugin declared an empty configSchema, so the inline dialog
            // should render the auto-form empty state instead of raw JSON.
            configFields,
            configParseError: configStatus.parseError ?? null,
            enabled: state.enabled,
            config,
            installedAt: state.installedAt,
            updatedAt: state.updatedAt,
            loaded: reg !== undefined,
          };
        }),
      )
    ).sort((a, b) => a.id.localeCompare(b.id));

    return npSuccessResponse({ items });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
