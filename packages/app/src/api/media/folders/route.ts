import {
  NpForbiddenError,
  NpNotFoundError,
  NpValidationError,
  NP_DEFAULT_SITE_ID,
  getCurrentSiteId,
  requireSiteId,
  npMediaFolders,
  can,
} from "@nexpress/core";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";

export async function GET(request: NextRequest) {
  try {
    // Folder structure is admin-library state — same gate as the
    // media listing (#73).
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("media-folders", "list");
    }

    const parentId = request.nextUrl.searchParams.get("parentId");
    await ensureFor("read");
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const db = getDb();

    const folders = parentId
      ? await db
          .select()
          .from(npMediaFolders)
          .where(and(eq(npMediaFolders.siteId, siteId), eq(npMediaFolders.parentId, parentId)))
      : await db.select().from(npMediaFolders).where(eq(npMediaFolders.siteId, siteId));

    return npSuccessResponse(folders);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("media-folders", "create");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId =
      typeof body.parentId === "string" && body.parentId.trim() ? body.parentId.trim() : null;

    if (!name) {
      throw new NpValidationError("Invalid input", [
        { field: "name", message: "Folder name is required" },
      ]);
    }

    await ensureFor("write");
    const siteId = await requireSiteId();
    const db = getDb();

    if (parentId) {
      const [parent] = await db
        .select({ id: npMediaFolders.id })
        .from(npMediaFolders)
        .where(and(eq(npMediaFolders.siteId, siteId), eq(npMediaFolders.id, parentId)))
        .limit(1);

      if (!parent) {
        throw new NpNotFoundError("media-folder", parentId);
      }
    }

    const [created] = await db
      .insert(npMediaFolders)
      .values({ siteId, name, parentId })
      .returning();

    return npSuccessResponse(created, { status: 201 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
