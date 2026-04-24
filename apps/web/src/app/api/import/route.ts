import {
  NxForbiddenError,
  NxValidationError,
  hasRole,
  nxMedia,
  nxPlugins,
  nxSettings,
  nxNavigation,
  getAllCollectionSlugs,
  saveDocument,
} from "@nexpress/core";
import type { NxNavItem } from "@nexpress/core";
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

const SUPPORTED_EXPORT_VERSION = "1";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";

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
    | Record<string, NxNavItem[]>
    | Array<{ location?: string; items: NxNavItem[] }>;
  collections?: Record<string, Record<string, unknown>[]>;
  media?: ImportMedia[];
  plugins?: ImportPlugin[];
}

function validatePayload(body: unknown): ImportPayload {
  if (!isRecord(body)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be a JSON object" },
    ]);
  }

  if (body.version !== undefined && body.version !== SUPPORTED_EXPORT_VERSION) {
    const supplied =
      typeof body.version === "string" || typeof body.version === "number"
        ? String(body.version)
        : "unknown";
    throw new NxValidationError("Invalid input", [
      {
        field: "version",
        message: `Unsupported export version "${supplied}" (expected "${SUPPORTED_EXPORT_VERSION}")`,
      },
    ]);
  }

  if (body.theme !== undefined && !isRecord(body.theme)) {
    throw new NxValidationError("Invalid input", [
      { field: "theme", message: "theme must be an object" },
    ]);
  }

  if (body.settings !== undefined && !isRecord(body.settings)) {
    throw new NxValidationError("Invalid input", [
      { field: "settings", message: "settings must be an object" },
    ]);
  }

  if (body.collections !== undefined) {
    if (!isRecord(body.collections)) {
      throw new NxValidationError("Invalid input", [
        { field: "collections", message: "collections must be an object" },
      ]);
    }

    for (const [slug, docs] of Object.entries(body.collections)) {
      if (!Array.isArray(docs) || !docs.every(isRecord)) {
        throw new NxValidationError("Invalid input", [
          { field: `collections.${slug}`, message: "Must be an array of objects" },
        ]);
      }
    }
  }

  if (body.media !== undefined) {
    if (!Array.isArray(body.media)) {
      throw new NxValidationError("Invalid input", [
        { field: "media", message: "media must be an array" },
      ]);
    }

    for (const [i, entry] of body.media.entries()) {
      if (!isRecord(entry) || typeof entry.id !== "string") {
        throw new NxValidationError("Invalid input", [
          { field: `media.${i}`, message: "Each media item must include an id" },
        ]);
      }
    }
  }

  if (body.plugins !== undefined) {
    if (!Array.isArray(body.plugins)) {
      throw new NxValidationError("Invalid input", [
        { field: "plugins", message: "plugins must be an array" },
      ]);
    }
    for (const [i, entry] of body.plugins.entries()) {
      if (!isRecord(entry) || typeof entry.id !== "string") {
        throw new NxValidationError("Invalid input", [
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
): Array<{ location: string; items: NxNavItem[] }> {
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

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("import", "create");
    }

    await ensureWriteReady();

    const payload = validatePayload(await request.json());
    const db = getDb();
    const warnings: string[] = [];
    const imported = {
      theme: 0,
      settings: 0,
      navigation: 0,
      pages: 0,
      mediaMatched: 0,
    };

    const mediaMap = new Map<string, string | null>();

    if (payload.media) {
      for (const m of payload.media) {
        if (m.hash) {
          const [match] = await db
            .select({ id: nxMedia.id })
            .from(nxMedia)
            .where(and(eq(nxMedia.hash, m.hash), isNull(nxMedia.deletedAt)))
            .limit(1);

          if (match) {
            mediaMap.set(m.id, match.id);
            continue;
          }
        }

        if (m.filename) {
          const [match] = await db
            .select({ id: nxMedia.id })
            .from(nxMedia)
            .where(and(eq(nxMedia.filename, m.filename), isNull(nxMedia.deletedAt)))
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

    await db.transaction(async (tx) => {
      const now = new Date();

      if (payload.theme) {
        await tx
          .insert(nxSettings)
          .values({ key: "theme", value: payload.theme, updatedAt: now, updatedBy: user.id })
          .onConflictDoUpdate({
            target: nxSettings.key,
            set: { value: payload.theme, updatedAt: now, updatedBy: user.id },
          });
        imported.theme = 1;
      }

      if (payload.settings) {
        for (const [key, value] of Object.entries(payload.settings)) {
          if (key === "theme") continue;

          await tx
            .insert(nxSettings)
            .values({ key, value, updatedAt: now, updatedBy: user.id })
            .onConflictDoUpdate({
              target: nxSettings.key,
              set: { value, updatedAt: now, updatedBy: user.id },
            });
          imported.settings++;
        }
      }

      for (const { location, items } of resolveNavEntries(payload.navigation)) {
        await tx
          .insert(nxNavigation)
          .values({ location, items, updatedAt: now, updatedBy: user.id })
          .onConflictDoUpdate({
            target: nxNavigation.location,
            set: { items, updatedAt: now, updatedBy: user.id },
          });
        imported.navigation++;
      }
    });

    const registeredSlugs = new Set(getAllCollectionSlugs());

    if (payload.collections) {
      for (const [slug, docs] of Object.entries(payload.collections)) {
        if (!registeredSlugs.has(slug)) {
          warnings.push(`Collection '${slug}' not registered, skipped`);
          continue;
        }

        for (const doc of docs) {
          const transformed = replaceMediaRefs(doc, mediaMap) as Record<string, unknown>;

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

    if (payload.plugins) {
      for (const plugin of payload.plugins) {
        // Only update rows that already exist (the plugin itself has to be
        // installed via nexpress.config.ts — importing never registers new
        // plugin code). Missing plugins are warned but not error.
        const [existing] = await db
          .select({ id: nxPlugins.id })
          .from(nxPlugins)
          .where(eq(nxPlugins.id, plugin.id))
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
          await db.update(nxPlugins).set(updateValues).where(eq(nxPlugins.id, plugin.id));
        }
      }
    }

    return nxSuccessResponse({ imported, warnings });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
