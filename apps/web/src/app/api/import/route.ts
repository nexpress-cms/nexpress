import {
  NpForbiddenError,
  NpValidationError,
  npMedia,
  npPlugins,
  npSettings,
  npNavigation,
  getAllCollectionSlugs,
  saveDocument,
  can,
} from "@nexpress/core";
import type { NpNavItem } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

const SUPPORTED_EXPORT_VERSION = "1";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

interface ImportMedia {
  id: string;
  filename?: string;
  hash?: string;
}

interface ImportPlugin {
  id: string;
  enabled?: boolean;
  config?: unknown;
}

interface ImportPayload {
  version?: string;
  theme?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  navigation?:
    | Record<string, NpNavItem[]>
    | Array<{ location?: string; items: NpNavItem[] }>;
  collections?: Record<string, Record<string, unknown>[]>;
  media?: ImportMedia[];
  plugins?: ImportPlugin[];
}

function validatePayload(body: unknown): ImportPayload {
  if (!isRecord(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be a JSON object" },
    ]);
  }

  if (body.version !== undefined && body.version !== SUPPORTED_EXPORT_VERSION) {
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

  if (body.theme !== undefined && !isRecord(body.theme)) {
    throw new NpValidationError("Invalid input", [
      { field: "theme", message: "theme must be an object" },
    ]);
  }

  if (body.settings !== undefined && !isRecord(body.settings)) {
    throw new NpValidationError("Invalid input", [
      { field: "settings", message: "settings must be an object" },
    ]);
  }

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
    }
  }

  return body as unknown as ImportPayload;
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
      location:
        typeof entry.location === "string" && entry.location.trim()
          ? entry.location.trim()
          : "main",
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
        if (payload.theme) imported.theme = 1;
        if (payload.settings) {
          imported.settings = Object.keys(payload.settings).filter((k) => k !== "theme").length;
        }
        imported.navigation = resolveNavEntries(payload.navigation).length;
      } else {
        // Phase 15.4 — import lands rows in the current site
        // (resolved from x-np-host). Cross-site import (a
        // super-admin picking a target site explicitly via a
        // request param) isn't built; the resolved siteId is
        // the only target today.
        const { getCurrentSiteId, NX_DEFAULT_SITE_ID } = await import(
          "@nexpress/core"
        );
        const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
        await db.transaction(async (tx) => {
          const now = new Date();

          if (payload.theme) {
            await tx
              .insert(npSettings)
              .values({ siteId, key: "theme", value: payload.theme, updatedAt: now, updatedBy: user.id })
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
      }
    } else if (payload.theme || payload.settings || payload.navigation || payload.plugins) {
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

          if (dryRun) {
            // Pipeline validation is the source of truth, but we can't run
            // it without writing. Report the count optimistically — errors
            // that only surface at write time will show up on the real run.
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

        const updateValues: Record<string, unknown> = { updatedAt: new Date() };
        if (plugin.enabled !== undefined) {
          if (typeof plugin.enabled !== "boolean") {
            warnings.push(`Plugin '${plugin.id}' enabled ignored — must be a boolean.`);
          } else {
            updateValues.enabled = plugin.enabled;
          }
        }
        if (plugin.config !== undefined) {
          if (!isRecord(plugin.config)) {
            warnings.push(`Plugin '${plugin.id}' config ignored — must be an object.`);
          } else {
            updateValues.config = plugin.config;
          }
        }
        if (Object.keys(updateValues).length > 1) {
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
