import {
  NxForbiddenError,
  hasRole,
  nxMedia,
  nxMediaRefs,
  nxPlugins,
  nxSettings,
  nxNavigation,
  getAllCollectionSlugs,
  findDocuments,
} from "@nexpress/core";
import { and, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

// Bump when the exported document shape changes in a
// backwards-incompatible way. Import validates this.
const EXPORT_VERSION = "1" as const;

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureCoreServices } from "@/lib/init-core";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("export", "read");
    }

    ensureCoreServices();
    const db = getDb();

    const settingsRows = await db.select().from(nxSettings);
    const navRows = await db.select().from(nxNavigation);

    const theme = settingsRows.find((r) => r.key === "theme")?.value;
    const settings = Object.fromEntries(
      settingsRows.filter((r) => r.key !== "theme").map((r) => [r.key, r.value]),
    );
    const navigation = Object.fromEntries(
      navRows.map((r) => [r.location, r.items]),
    );

    const collections: Record<string, Record<string, unknown>[]> = {};

    for (const slug of getAllCollectionSlugs()) {
      const result = await findDocuments(slug, { limit: 10000 }, undefined);
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
    // itself is managed via nexpress.config.ts.
    const pluginRows = await db.select().from(nxPlugins);
    const plugins = pluginRows.map((row) => ({
      id: row.id,
      enabled: row.enabled,
      config: row.config,
    }));

    return nxSuccessResponse({
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      theme,
      settings,
      navigation,
      collections,
      media,
      plugins,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
