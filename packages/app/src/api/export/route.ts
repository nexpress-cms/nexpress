import {
  NpForbiddenError,
  NpValidationError,
  npMedia,
  npMediaRefs,
  npPlugins,
  npSettings,
  npNavigation,
  getAllCollectionSlugs,
  getPluginConfig,
  getPluginRegistration,
  getThemeById,
  getThemeSettingsWithStatus,
  findDocuments,
  getCurrentSiteId,
  getSiteGeneralSettings,
  NP_DEFAULT_SITE_ID,
  can,
} from "@nexpress/core";
import { npAnalyzeSettingRecord } from "@nexpress/core/settings";
import { npAnalyzeThemeTokensOverlay } from "@nexpress/core/theme";
import { npAnalyzeNavigationItems, npAnalyzeNavigationLocation } from "@nexpress/core/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

// Bump when the exported document shape changes in a
// backwards-incompatible way. Import validates this.
const EXPORT_VERSION = "2" as const;

import { requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

/**
 * Comma-separated list in `?collections=a,b` restricts the export to just
 * those collection slugs — and drops theme/settings/navigation/plugins so
 * the payload stays focused on content migration. Empty / missing param =
 * full export.
 */
function parseCollectionsFilter(request: NextRequest): string[] | null {
  const raw = request.nextUrl.searchParams.get("collections");
  if (!raw) return null;
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (slugs.length === 0) return null;
  const registered = new Set(getAllCollectionSlugs());
  const unknown = slugs.filter((slug) => !registered.has(slug));
  if (unknown.length > 0) {
    throw new NpValidationError("Invalid input", [
      { field: "collections", message: `Unknown collection(s): ${unknown.join(", ")}` },
    ]);
  }
  return slugs;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("export", "read");
    }
    await ensureFor("plugins");
    const db = getDb();
    const collectionsFilter = parseCollectionsFilter(request);
    const partial = collectionsFilter !== null;

    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const settingsRows = partial
      ? []
      : await db.select().from(npSettings).where(eq(npSettings.siteId, siteId));
    const navRows = partial
      ? []
      : await db.select().from(npNavigation).where(eq(npNavigation.siteId, siteId));
    const pluginRows = partial ? [] : await db.select().from(npPlugins);
    const pluginStateIds = new Set(pluginRows.map((row) => row.id));

    const theme = settingsRows.find((r) => r.key === "theme")?.value;
    const themeIssues = theme === undefined ? [] : npAnalyzeThemeTokensOverlay(theme);
    if (themeIssues.length > 0) {
      throw new NpValidationError(
        "Invalid stored theme tokens",
        themeIssues.map((issue) => ({
          field: issue.path.replace(/^theme/u, "settings.theme"),
          message: issue.message,
        })),
      );
    }
    const exportedSettingRows = settingsRows.filter(
      (row) => row.key !== "theme" && !row.key.startsWith("plugin.config:"),
    );
    for (const row of settingsRows.filter((entry) => entry.key.startsWith("plugin.config:"))) {
      const pluginId = row.key.slice("plugin.config:".length);
      if (!getPluginRegistration(pluginId)) {
        throw new NpValidationError("Invalid stored settings", [
          {
            field: `settings.${row.key}`,
            message: `Plugin '${pluginId}' is not loaded from nexpress.config.ts.`,
          },
        ]);
      }
      if (!pluginStateIds.has(pluginId)) {
        throw new NpValidationError("Invalid stored settings", [
          {
            field: `settings.${row.key}`,
            message: `Plugin '${pluginId}' has config but no np_plugins state row.`,
          },
        ]);
      }
      await getPluginConfig(pluginId);
    }
    const settingIssues = exportedSettingRows.flatMap((row) =>
      npAnalyzeSettingRecord(row.siteId, row.key, row.value).map((entry) => ({
        field: entry.path,
        message: entry.message,
      })),
    );
    if (settingIssues.length > 0) {
      throw new NpValidationError("Invalid stored settings", settingIssues);
    }
    const canonicalSettingValues = new Map<string, unknown>();
    for (const row of exportedSettingRows) {
      if (
        row.key === "activeTheme" &&
        (typeof row.value !== "string" || !getThemeById(row.value))
      ) {
        throw new NpValidationError("Invalid stored settings", [
          {
            field: "settings.activeTheme",
            message: `Theme '${String(row.value)}' is not registered.`,
          },
        ]);
      }
      if (row.key.startsWith("theme.settings:")) {
        const themeId = row.key.slice("theme.settings:".length);
        const theme = getThemeById(themeId);
        if (!theme) {
          throw new NpValidationError("Invalid stored settings", [
            {
              field: `settings.${row.key}`,
              message: `Theme '${themeId}' is not registered.`,
            },
          ]);
        }
        const status = await getThemeSettingsWithStatus(themeId);
        canonicalSettingValues.set(row.key, {
          __npVersion: theme.manifest.settingsVersion ?? 1,
          __npSettings: status.value,
        });
      }
    }
    const settings = Object.fromEntries(
      exportedSettingRows.map((row) => [row.key, canonicalSettingValues.get(row.key) ?? row.value]),
    );
    const site = partial ? null : await getSiteGeneralSettings(siteId);
    const navigationIssues = navRows.flatMap((row) => [
      ...npAnalyzeNavigationLocation(row.location).map((issue) => ({
        field: issue.path.replace(/^navigation\.location/u, `navigation.${row.location}`),
        message: issue.message,
      })),
      ...npAnalyzeNavigationItems(row.items).map((issue) => ({
        field: issue.path.replace(/^navigation\.items/u, `navigation.${row.location}`),
        message: issue.message,
      })),
    ]);
    if (navigationIssues.length > 0) {
      throw new NpValidationError("Invalid stored navigation", navigationIssues);
    }
    const navigation = Object.fromEntries(navRows.map((r) => [r.location, r.items]));

    const exportSlugs = collectionsFilter ?? getAllCollectionSlugs();
    const collections: Record<string, Record<string, unknown>[]> = {};
    for (const slug of exportSlugs) {
      // Pass the authenticated admin user so collections with custom
      // `access.read` get evaluated against the real principal — not
      // the anonymous/public path. Without this an admin backup
      // silently dropped private collections (#66).
      const result = await findDocuments(slug, { limit: 10000 }, user);
      collections[slug] = result.docs;
    }

    const refRows = await db.selectDistinct({ mediaId: npMediaRefs.mediaId }).from(npMediaRefs);
    const mediaIds = refRows.map((r) => r.mediaId);

    const media =
      mediaIds.length > 0
        ? await db
            .select({
              id: npMedia.id,
              filename: npMedia.filename,
              hash: npMedia.hash,
              mimeType: npMedia.mimeType,
            })
            .from(npMedia)
            .where(and(inArray(npMedia.id, mediaIds), isNull(npMedia.deletedAt)))
        : [];

    // Plugin registrations + per-plugin config/enabled flags so a re-import
    // lands in the same state. We export what's in the DB — plugin code
    // itself is managed via nexpress.config.ts. Skipped entirely when a
    // collection filter is active (partial export = content only).
    // G.1 — plugin config moved to np_settings; resolve per-plugin via
    // `getPluginConfig` which unwraps the versioned envelope. Promise.all
    // is fine here because the query count grows linearly with installed
    // plugin count (currently ≤ 11) and exports are rare admin actions.
    const plugins = await Promise.all(
      pluginRows.map(async (row) => {
        const registration = getPluginRegistration(row.id);
        if (!registration) {
          throw new NpValidationError("Invalid stored plugin state", [
            {
              field: `plugins.${row.id}`,
              message: `Plugin '${row.id}' is installed in the database but is not loaded from nexpress.config.ts.`,
            },
          ]);
        }
        const config = (await getPluginConfig(row.id)) ?? {};
        return {
          id: row.id,
          enabled: row.enabled,
          config,
          manifestVersion: registration.version ?? null,
        };
      }),
    );

    return npSuccessResponse({
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      siteUrl: site?.url ?? process.env.SITE_URL ?? null,
      partial,
      collectionsExported: exportSlugs,
      ...(partial ? {} : { site, theme, settings, navigation }),
      collections,
      media,
      ...(partial ? {} : { plugins }),
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
