import {
  NpForbiddenError,
  NpNotFoundError,
  NpValidationError,
  npMediaFolders,
  can,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { requireAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";

export async function GET(request: NextRequest) {
  try {
    // Folder structure is admin-library state — same gate as the
    // media listing (#73).
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("media-folders", "list");
    }

    const parentId = request.nextUrl.searchParams.get("parentId");
    const db = getDb();

    const folders = parentId
      ? await db
          .select()
          .from(npMediaFolders)
          .where(eq(npMediaFolders.parentId, parentId))
      : await db.select().from(npMediaFolders);

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
      typeof body.parentId === "string" && body.parentId.trim()
        ? body.parentId.trim()
        : null;

    if (!name) {
      throw new NpValidationError("Invalid input", [
        { field: "name", message: "Folder name is required" },
      ]);
    }

    const db = getDb();

    if (parentId) {
      const [parent] = await db
        .select({ id: npMediaFolders.id })
        .from(npMediaFolders)
        .where(eq(npMediaFolders.id, parentId))
        .limit(1);

      if (!parent) {
        throw new NpNotFoundError("media-folder", parentId);
      }
    }

    const [created] = await db
      .insert(npMediaFolders)
      .values({ name, parentId })
      .returning();

    return npSuccessResponse(created, { status: 201 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
