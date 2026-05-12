import {
  NpConflictError,
  NpForbiddenError,
  NpNotFoundError,
  NpValidationError,
  npMedia,
  npMediaFolders,
  can,
} from "@nexpress/core";
import { and, count, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireAuth(request);

    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("media-folders", "update");
    }

    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      throw new NpValidationError("Invalid input", [
        { field: "name", message: "Folder name is required" },
      ]);
    }

    const db = getDb();
    const [updated] = await db
      .update(npMediaFolders)
      .set({ name })
      .where(eq(npMediaFolders.id, id))
      .returning();

    if (!updated) {
      throw new NpNotFoundError("media-folder", id);
    }

    return npSuccessResponse(updated);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("media-folders", "delete");
    }

    const db = getDb();

    const [folder] = await db
      .select({ id: npMediaFolders.id })
      .from(npMediaFolders)
      .where(eq(npMediaFolders.id, id))
      .limit(1);

    if (!folder) {
      throw new NpNotFoundError("media-folder", id);
    }

    const [mediaCount] = await db
      .select({ total: count() })
      .from(npMedia)
      .where(and(eq(npMedia.folderId, id), isNull(npMedia.deletedAt)));

    if (Number(mediaCount.total) > 0) {
      throw new NpConflictError("Folder contains media files");
    }

    const [childCount] = await db
      .select({ total: count() })
      .from(npMediaFolders)
      .where(eq(npMediaFolders.parentId, id));

    if (Number(childCount.total) > 0) {
      throw new NpConflictError("Folder has child folders");
    }

    await db.delete(npMediaFolders).where(eq(npMediaFolders.id, id));

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
