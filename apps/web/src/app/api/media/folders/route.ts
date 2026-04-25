import {
  NxForbiddenError,
  NxNotFoundError,
  NxValidationError,
  hasRole,
  nxMediaFolders,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    // Folder structure is admin-library state — same gate as the
    // media listing (#73).
    const user = await requireAuth(request);
    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("media-folders", "list");
    }

    const parentId = request.nextUrl.searchParams.get("parentId");
    const db = getDb();

    const folders = parentId
      ? await db
          .select()
          .from(nxMediaFolders)
          .where(eq(nxMediaFolders.parentId, parentId))
      : await db.select().from(nxMediaFolders);

    return nxSuccessResponse(folders);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("media-folders", "create");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId =
      typeof body.parentId === "string" && body.parentId.trim()
        ? body.parentId.trim()
        : null;

    if (!name) {
      throw new NxValidationError("Invalid input", [
        { field: "name", message: "Folder name is required" },
      ]);
    }

    const db = getDb();

    if (parentId) {
      const [parent] = await db
        .select({ id: nxMediaFolders.id })
        .from(nxMediaFolders)
        .where(eq(nxMediaFolders.id, parentId))
        .limit(1);

      if (!parent) {
        throw new NxNotFoundError("media-folder", parentId);
      }
    }

    const [created] = await db
      .insert(nxMediaFolders)
      .values({ name, parentId })
      .returning();

    return nxSuccessResponse(created, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
