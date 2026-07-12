import {
  NpForbiddenError,
  NpValidationError,
  npMedia,
  npPlugins,
  npSettings,
  npNavigation,
  getAllCollectionSlugs,
  getPluginRegistration,
  getThemeById,
  saveDocument,
  setPluginConfig,
  setSiteGeneralSettings,
  can,
} from "@nexpress/core";
import {
  npAnalyzeSettingValue,
  npNormalizeSiteGeneralSettings,
  type NpSiteGeneralSettings,
} from "@nexpress/core/settings";
import { npAnalyzeThemeTokensOverlay, type NpThemeTokensOverlay } from "@nexpress/core/theme";
import {
  npAnalyzeNavigationItems,
  npAnalyzeNavigationLocation,
  type NpNavItem,
} from "@nexpress/core/navigation";
import { invalidateCacheTargets, navCacheTag, readJsonBody } from "@nexpress/next";
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

const SUPPORTED_EXPORT_VERSION = "2";

import { requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { validateDocumentBlockContent } from "../../lib/block-content-validation";
import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

interface ImportMedia {
  id: string;
  filename?: string;
  hash?: string;
  mimeType?: string;
}

interface ImportPlugin {
  id: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  manifestVersion?: string;
}

interface ImportPayload {
  version?: string;
  site?: NpSiteGeneralSettings;
  theme?: NpThemeTokensOverlay;
  settings?: Record<string, unknown>;
  navigation?: Record<string, NpNavItem[]> | Array<{ location?: string; items: NpNavItem[] }>;
  collections?: Record<string, Record<string, unknown>[]>;
  media?: ImportMedia[];
  plugins?: ImportPlugin[];
}

function validateNavigationPayload(value: unknown): void {
  if (value === undefined) return;
  const errors: Array<{ field: string; message: string }> = [];

  if (Array.isArray(value)) {
    const locations = new Set<string>();
    for (const [index, entry] of value.entries()) {
      const path = `navigation.${index.toString()}`;
      if (!isRecord(entry)) {
        errors.push({ field: path, message: "navigation entries must be plain objects" });
        continue;
      }
      for (const key of Object.keys(entry)) {
        if (key !== "location" && key !== "items") {
          errors.push({
            field: `${path}.${key}`,
            message: `unsupported navigation field "${key}"`,
          });
        }
      }
      const location = entry.location === undefined ? "main" : entry.location;
      for (const issue of npAnalyzeNavigationLocation(location)) {
        errors.push({
          field: issue.path.replace(/^navigation\.location/u, `${path}.location`),
          message: issue.message,
        });
      }
      if (typeof location === "string") {
        if (locations.has(location)) {
          errors.push({
            field: `${path}.location`,
            message: `duplicate navigation location "${location}"`,
          });
        }
        locations.add(location);
      }
      for (const issue of npAnalyzeNavigationItems(entry.items)) {
        errors.push({
          field: issue.path.replace(/^navigation/u, path),
          message: issue.message,
        });
      }
    }
  } else if (isRecord(value)) {
    for (const [location, items] of Object.entries(value)) {
      for (const issue of npAnalyzeNavigationLocation(location)) {
        errors.push({
          field: issue.path.replace(/^navigation\.location/u, `navigation.${location}`),
          message: issue.message,
        });
      }
      for (const issue of npAnalyzeNavigationItems(items)) {
        errors.push({
          field: issue.path.replace(/^navigation\.items/u, `navigation.${location}`),
          message: issue.message,
        });
      }
    }
  } else {
    errors.push({ field: "navigation", message: "navigation must be an object or entry array" });
  }

  if (errors.length > 0) throw new NpValidationError("Invalid input", errors);
}

function validatePayload(body: unknown): ImportPayload {
  if (!isRecord(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be a JSON object" },
    ]);
  }

  const allowed = new Set([
    "version",
    "exportedAt",
    "siteUrl",
    "partial",
    "collectionsExported",
    "site",
    "theme",
    "settings",
    "navigation",
    "collections",
    "media",
    "plugins",
  ]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) {
    throw new NpValidationError("Invalid input", [
      { field: unknown, message: `Unsupported import field "${unknown}"` },
    ]);
  }

  if (body.version !== SUPPORTED_EXPORT_VERSION) {
    const supplied =
      typeof body.version === "string" || typeof body.version === "number"
        ? String(body.version)
        : "unknown";
    throw new NpValidationError("Invalid input", [
      {
        field: "version",
        message: `Unsupported export version "${supplied}" (expected "${SUPPORTED_EXPORT_VERSION}")`,
      },
    ]);
  }
  if (
    body.exportedAt !== undefined &&
    (typeof body.exportedAt !== "string" ||
      Number.isNaN(new Date(body.exportedAt).valueOf()) ||
      new Date(body.exportedAt).toISOString() !== body.exportedAt)
  ) {
    throw new NpValidationError("Invalid input", [
      { field: "exportedAt", message: "exportedAt must be an ISO date-time string" },
    ]);
  }
  if (body.siteUrl !== undefined && body.siteUrl !== null && typeof body.siteUrl !== "string") {
    throw new NpValidationError("Invalid input", [
      { field: "siteUrl", message: "siteUrl must be a string or null" },
    ]);
  }
  if (body.partial !== undefined && typeof body.partial !== "boolean") {
    throw new NpValidationError("Invalid input", [
      { field: "partial", message: "partial must be boolean" },
    ]);
  }
  if (
    body.collectionsExported !== undefined &&
    (!Array.isArray(body.collectionsExported) ||
      !body.collectionsExported.every((entry) => typeof entry === "string"))
  ) {
    throw new NpValidationError("Invalid input", [
      { field: "collectionsExported", message: "collectionsExported must be a string array" },
    ]);
  }

  if (body.theme !== undefined) {
    const tokenIssues = npAnalyzeThemeTokensOverlay(body.theme);
    if (tokenIssues.length > 0) {
      throw new NpValidationError(
        "Invalid input",
        tokenIssues.map((issue) => ({ field: issue.path, message: issue.message })),
      );
    }
  }

  if (body.site !== undefined) {
    try {
      npNormalizeSiteGeneralSettings(body.site);
    } catch (error) {
      throw new NpValidationError("Invalid input", [
        { field: "site", message: error instanceof Error ? error.message : "Invalid site" },
      ]);
    }
  }

  if (body.settings !== undefined) {
    if (!isRecord(body.settings)) {
      throw new NpValidationError("Invalid input", [
        { field: "settings", message: "settings must be an object" },
      ]);
    }
    const settingErrors = Object.entries(body.settings).flatMap(([key, value]) =>
      npAnalyzeSettingValue(key, value).map((entry) => ({
        field: entry.path,
        message: entry.message,
      })),
    );
    if (settingErrors.length > 0) {
      throw new NpValidationError("Invalid input", settingErrors);
    }
    for (const [key, value] of Object.entries(body.settings)) {
      if (key.startsWith("plugin.config:")) {
        throw new NpValidationError("Invalid input", [
          {
            field: `settings.${key}`,
            message:
              "Plugin config belongs in the top-level plugins array so its registered schema can validate it.",
          },
        ]);
      }
      if (key === "activeTheme") {
        if (typeof value !== "string" || !getThemeById(value)) {
          throw new NpValidationError("Invalid input", [
            {
              field: "settings.activeTheme",
              message: `Theme '${String(value)}' is not registered.`,
            },
          ]);
        }
      }
      if (key.startsWith("theme.settings:")) {
        const themeId = key.slice("theme.settings:".length);
        const theme = getThemeById(themeId);
        if (!theme) {
          throw new NpValidationError("Invalid input", [
            { field: `settings.${key}`, message: `Theme '${themeId}' is not registered.` },
          ]);
        }
        const envelope = value as { __npSettings: unknown };
        const schema = theme.manifest.settingsSchema as
          | { safeParse(input: unknown): { success: boolean; error?: { message: string } } }
          | undefined;
        const parsed = schema?.safeParse(envelope.__npSettings);
        if (!schema || !parsed?.success) {
          throw new NpValidationError("Invalid input", [
            {
              field: `settings.${key}`,
              message: !schema
                ? `Theme '${themeId}' does not declare settingsSchema.`
                : (parsed?.error?.message ?? "Theme settings failed validation"),
            },
          ]);
        }
      }
    }
  }

  validateNavigationPayload(body.navigation);

  if (body.collections !== undefined) {
    if (!isRecord(body.collections)) {
      throw new NpValidationError("Invalid input", [
        { field: "collections", message: "collections must be an object" },
      ]);
    }

    for (const [slug, docs] of Object.entries(body.collections)) {
      if (!Array.isArray(docs) || !docs.every(isRecord)) {
        throw new NpValidationError("Invalid input", [
          { field: `collections.${slug}`, message: "Must be an array of objects" },
        ]);
      }
    }
  }

  if (body.media !== undefined) {
    if (!Array.isArray(body.media)) {
      throw new NpValidationError("Invalid input", [
        { field: "media", message: "media must be an array" },
      ]);
    }

    for (const [i, entry] of body.media.entries()) {
      if (!isRecord(entry) || typeof entry.id !== "string") {
        throw new NpValidationError("Invalid input", [
          { field: `media.${i}`, message: "Each media item must include an id" },
        ]);
      }
      const unknown = Object.keys(entry).find(
        (key) => key !== "id" && key !== "filename" && key !== "hash" && key !== "mimeType",
      );
      if (unknown) {
        throw new NpValidationError("Invalid input", [
          { field: `media.${i}.${unknown}`, message: `Unsupported media field "${unknown}"` },
        ]);
      }
      for (const key of ["filename", "hash", "mimeType"] as const) {
        if (entry[key] !== undefined && typeof entry[key] !== "string") {
          throw new NpValidationError("Invalid input", [
            { field: `media.${i}.${key}`, message: `${key} must be a string` },
          ]);
        }
      }
    }
  }

  if (body.plugins !== undefined) {
    if (!Array.isArray(body.plugins)) {
      throw new NpValidationError("Invalid input", [
        { field: "plugins", message: "plugins must be an array" },
      ]);
    }
    for (const [i, entry] of body.plugins.entries()) {
      if (!isRecord(entry) || typeof entry.id !== "string") {
        throw new NpValidationError("Invalid input", [
          { field: `plugins.${i}.id`, message: "Each plugin must include an id" },
        ]);
      }
      const unknown = Object.keys(entry).find(
        (key) => key !== "id" && key !== "enabled" && key !== "config" && key !== "manifestVersion",
      );
      if (unknown) {
        throw new NpValidationError("Invalid input", [
          { field: `plugins.${i}.${unknown}`, message: `Unsupported plugin field "${unknown}"` },
        ]);
      }
      if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") {
        throw new NpValidationError("Invalid input", [
          { field: `plugins.${i}.enabled`, message: "enabled must be boolean" },
        ]);
      }
      if (entry.config !== undefined && !isRecord(entry.config)) {
        throw new NpValidationError("Invalid input", [
          { field: `plugins.${i}.config`, message: "config must be a plain object" },
        ]);
      }
      if (entry.manifestVersion !== undefined && typeof entry.manifestVersion !== "string") {
        throw new NpValidationError("Invalid input", [
          { field: `plugins.${i}.manifestVersion`, message: "manifestVersion must be a string" },
        ]);
      }
    }
  }

  return body;
}

function replaceMediaRefs(value: unknown, mediaMap: ReadonlyMap<string, string | null>): unknown {
  if (typeof value === "string") {
    return mediaMap.has(value) ? (mediaMap.get(value) ?? null) : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => replaceMediaRefs(entry, mediaMap));
  }

  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, replaceMediaRefs(nested, mediaMap)]),
  );
}

function resolveNavEntries(
  navigation: ImportPayload["navigation"],
): Array<{ location: string; items: NpNavItem[] }> {
  if (!navigation) return [];

  if (Array.isArray(navigation)) {
    return navigation.map((entry) => ({
      location: entry.location ?? "main",
      items: entry.items,
    }));
  }

  return Object.entries(navigation).map(([location, items]) => ({ location, items }));
}

/**
 * Parses `?collections=a,b` — when present, only those collection slugs
 * are imported AND theme/settings/navigation/plugins are skipped entirely.
 * Mirrors the export filter contract so a partial export/import round-trip
 * works symmetrically.
 */
function parseCollectionsFilter(
  request: NextRequest,
  registered: ReadonlySet<string>,
): Set<string> | null {
  const raw = request.nextUrl.searchParams.get("collections");
  if (!raw) return null;
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (slugs.length === 0) return null;
  const unknown = slugs.filter((slug) => !registered.has(slug));
  if (unknown.length > 0) {
    throw new NpValidationError("Invalid input", [
      { field: "collections", message: `Unknown collection(s): ${unknown.join(", ")}` },
    ]);
  }
  return new Set(slugs);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("import", "create");
    }

    await ensureFor("write");

    const payload = validatePayload(await readJsonBody(request));
    const db = getDb();
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
    const registeredSlugs = new Set(getAllCollectionSlugs());
    const filter = parseCollectionsFilter(request, registeredSlugs);
    const partial = filter !== null;

    const warnings: string[] = [];
    const imported = {
      theme: 0,
      settings: 0,
      navigation: 0,
      pages: 0,
      mediaMatched: 0,
      pluginsUpdated: 0,
    };

    const mediaMap = new Map<string, string | null>();

    // Media resolution is read-only — safe to run unchanged in dry-run mode.
    // The resulting `mediaMap` feeds the per-doc `replaceMediaRefs` call so
    // the dry-run report accurately mirrors what the write path would do.
    if (payload.media) {
      for (const m of payload.media) {
        if (m.hash) {
          const [match] = await db
            .select({ id: npMedia.id })
            .from(npMedia)
            .where(and(eq(npMedia.hash, m.hash), isNull(npMedia.deletedAt)))
            .limit(1);

          if (match) {
            mediaMap.set(m.id, match.id);
            continue;
          }
        }

        if (m.filename) {
          const [match] = await db
            .select({ id: npMedia.id })
            .from(npMedia)
            .where(and(eq(npMedia.filename, m.filename), isNull(npMedia.deletedAt)))
            .limit(1);

          if (match) {
            warnings.push(`Media '${m.id}' matched by filename fallback`);
            mediaMap.set(m.id, match.id);
            continue;
          }
        }

        mediaMap.set(m.id, null);
        warnings.push(`Media '${m.id}' not matched, references nullified`);
      }

      imported.mediaMatched = [...mediaMap.values()].filter(Boolean).length;
    }

    if (!partial) {
      if (dryRun) {
        if (payload.site) imported.settings++;
        if (payload.theme) imported.theme = 1;
        if (payload.settings) {
          imported.settings += Object.keys(payload.settings).filter((k) => k !== "theme").length;
        }
        imported.navigation = resolveNavEntries(payload.navigation).length;
      } else {
        // Phase 15.4 — import lands rows in the current site
        // (resolved from x-np-host). Cross-site import (a
        // super-admin picking a target site explicitly via a
        // request param) isn't built; the resolved siteId is
        // the only target today.
        const { getCurrentSiteId, NP_DEFAULT_SITE_ID } = await import("@nexpress/core");
        const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
        if (payload.site) {
          await setSiteGeneralSettings(payload.site, siteId);
          imported.settings++;
        }
        await db.transaction(async (tx) => {
          const now = new Date();

          if (payload.theme) {
            await tx
              .insert(npSettings)
              .values({
                siteId,
                key: "theme",
                value: payload.theme,
                updatedAt: now,
                updatedBy: user.id,
              })
              .onConflictDoUpdate({
                target: [npSettings.siteId, npSettings.key],
                set: { value: payload.theme, updatedAt: now, updatedBy: user.id },
              });
            imported.theme = 1;
          }

          if (payload.settings) {
            for (const [key, value] of Object.entries(payload.settings)) {
              if (key === "theme") continue;

              await tx
                .insert(npSettings)
                .values({ siteId, key, value, updatedAt: now, updatedBy: user.id })
                .onConflictDoUpdate({
                  target: [npSettings.siteId, npSettings.key],
                  set: { value, updatedAt: now, updatedBy: user.id },
                });
              imported.settings++;
            }
          }

          for (const { location, items } of resolveNavEntries(payload.navigation)) {
            await tx
              .insert(npNavigation)
              .values({ siteId, location, items, updatedAt: now, updatedBy: user.id })
              .onConflictDoUpdate({
                target: [npNavigation.siteId, npNavigation.location],
                set: { items, updatedAt: now, updatedBy: user.id },
              });
            imported.navigation++;
          }
        });

        for (const { location } of resolveNavEntries(payload.navigation)) {
          invalidateCacheTargets({
            source: "navigation",
            siteId,
            navigationLocation: location,
            tags: [navCacheTag(siteId, location)],
            paths: [{ path: "/", type: "layout" }],
          });
        }
      }
    } else if (
      payload.site ||
      payload.theme ||
      payload.settings ||
      payload.navigation ||
      payload.plugins
    ) {
      warnings.push(
        "Partial import (collections filter) — theme/settings/navigation/plugins in payload are ignored.",
      );
    }

    if (payload.collections) {
      for (const [slug, docs] of Object.entries(payload.collections)) {
        if (filter && !filter.has(slug)) {
          continue;
        }
        if (!registeredSlugs.has(slug)) {
          warnings.push(`Collection '${slug}' not registered, skipped`);
          continue;
        }

        for (const doc of docs) {
          const transformed = replaceMediaRefs(doc, mediaMap) as Record<string, unknown>;

          try {
            validateDocumentBlockContent(slug, transformed);
          } catch (error) {
            warnings.push(
              `Failed to import doc in '${slug}': ${error instanceof Error ? error.message : "unknown"}`,
            );
            continue;
          }

          if (dryRun) {
            // Definition-aware block validation is safe to run above. The
            // remaining collection pipeline checks require a write, so their
            // failures can still surface only during the real import.
            imported.pages++;
            continue;
          }

          try {
            await saveDocument(slug, null, transformed, user);
            imported.pages++;
          } catch (err) {
            warnings.push(
              `Failed to import doc in '${slug}': ${err instanceof Error ? err.message : "unknown"}`,
            );
          }
        }
      }
    }

    if (!partial && payload.plugins) {
      for (const plugin of payload.plugins) {
        // Only update rows that already exist (the plugin itself has to be
        // installed via nexpress.config.ts — importing never registers new
        // plugin code). Missing plugins are warned but not error.
        const [existing] = await db
          .select({ id: npPlugins.id })
          .from(npPlugins)
          .where(eq(npPlugins.id, plugin.id))
          .limit(1);
        if (!existing) {
          warnings.push(
            `Plugin '${plugin.id}' state not imported — plugin is not installed on this instance.`,
          );
          continue;
        }
        const registration = getPluginRegistration(plugin.id);
        if (!registration) {
          throw new NpValidationError("Invalid input", [
            {
              field: `plugins.${plugin.id}`,
              message: `Plugin '${plugin.id}' is installed in the database but is not loaded from nexpress.config.ts.`,
            },
          ]);
        }

        const updateValues: Record<string, unknown> = { updatedAt: new Date() };
        let changed = false;
        if (plugin.enabled !== undefined) {
          updateValues.enabled = plugin.enabled;
          changed = true;
        }
        if (plugin.config !== undefined) {
          const schema = registration.configSchema as
            | { safeParse(value: unknown): { success: boolean; error?: { message: string } } }
            | undefined;
          const parsed = schema?.safeParse(plugin.config);
          if (parsed && !parsed.success) {
            throw new NpValidationError("Invalid input", [
              {
                field: `plugins.${plugin.id}.config`,
                message: parsed.error?.message ?? "Plugin config failed its registered schema",
              },
            ]);
          }
          if (!dryRun) await setPluginConfig(plugin.id, plugin.config, user.id);
          changed = true;
        }
        if (changed) {
          if (!dryRun) {
            await db.update(npPlugins).set(updateValues).where(eq(npPlugins.id, plugin.id));
          }
          imported.pluginsUpdated++;
        }
      }
    }

    return npSuccessResponse({ imported, warnings, dryRun, partial });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
