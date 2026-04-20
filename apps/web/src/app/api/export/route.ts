import {
  NxForbiddenError,
  hasRole,
  nxMedia,
  nxMediaRefs,
  nxSettings,
  nxNavigation,
  getAllCollectionSlugs,
  findDocuments,
} from "@nexpress/core";
import { and, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

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

    return nxSuccessResponse({ theme, settings, navigation, collections, media });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
