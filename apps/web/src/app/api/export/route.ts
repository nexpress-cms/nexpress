import {
  NxForbiddenError,
  NxValidationError,
  nxMedia,
  nxMediaRefs,
  nxPlugins,
  nxSettings,
  nxNavigation,
  getAllCollectionSlugs,
  getPluginRegistration,
  findDocuments,
  can,
} from "@nexpress/core";
import { and, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

// Bump when the exported document shape changes in a
// backwards-incompatible way. Import validates this.
const EXPORT_VERSION = "1" as const;

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";

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
    throw new NxValidationError("Invalid input", [
      { field: "collections", message: `Unknown collection(s): ${unknown.join(", ")}` },
    ]);
  }
  return slugs;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("export", "read");
    }

    ensureCoreServices();
    await ensurePluginsLoaded();
    const db = getDb();
    const collectionsFilter = parseCollectionsFilter(request);
    const partial = collectionsFilter !== null;

    const settingsRows = partial ? [] : await db.select().from(nxSettings);
    const navRows = partial ? [] : await db.select().from(nxNavigation);

    const theme = settingsRows.find((r) => r.key === "theme")?.value;
    const settings = Object.fromEntries(
      settingsRows.filter((r) => r.key !== "theme").map((r) => [r.key, r.value]),
    );
    const navigation = Object.fromEntries(
      navRows.map((r) => [r.location, r.items]),
    );

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

    const refRows = await db
      .selectDistinct({ mediaId: nxMediaRefs.mediaId })
      .from(nxMediaRefs);
    const mediaIds = refRows.map((r) => r.mediaId);

    const media =
      mediaIds.length > 0
        ? await db
            .select({
              id: nxMedia.id,
              filename: nxMedia.filename,
              hash: nxMedia.hash,
              mimeType: nxMedia.mimeType,
            })
            .from(nxMedia)
            .where(and(inArray(nxMedia.id, mediaIds), isNull(nxMedia.deletedAt)))
        : [];

    // Plugin registrations + per-plugin config/enabled flags so a re-import
    // lands in the same state. We export what's in the DB — plugin code
    // itself is managed via nexpress.config.ts. Skipped entirely when a
    // collection filter is active (partial export = content only).
    const pluginRows = partial ? [] : await db.select().from(nxPlugins);
    const plugins = pluginRows.map((row) => {
      const registration = getPluginRegistration(row.id);
      return {
        id: row.id,
        enabled: row.enabled,
        config: row.config,
        manifestVersion: registration?.version ?? null,
      };
    });

    return nxSuccessResponse({
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      siteUrl: process.env.SITE_URL ?? null,
      partial,
      collectionsExported: exportSlugs,
      ...(partial ? {} : { theme, settings, navigation }),
      collections,
      media,
      ...(partial ? {} : { plugins }),
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
