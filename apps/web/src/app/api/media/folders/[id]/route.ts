import {
  NxConflictError,
  NxForbiddenError,
  NxNotFoundError,
  NxValidationError,
  hasRole,
  nxMedia,
  nxMediaFolders,
} from "@nexpress/core";
import { and, count, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "editor")) {
      throw new NxForbiddenError("media-folders", "update");
    }

    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      throw new NxValidationError("Invalid input", [
        { field: "name", message: "Folder name is required" },
      ]);
    }

    const db = getDb();
    const [updated] = await db
      .update(nxMediaFolders)
      .set({ name })
      .where(eq(nxMediaFolders.id, id))
      .returning();

    if (!updated) {
      throw new NxNotFoundError("media-folder", id);
    }

    return nxSuccessResponse(updated);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("media-folders", "delete");
    }

    const db = getDb();

    const [folder] = await db
      .select({ id: nxMediaFolders.id })
      .from(nxMediaFolders)
      .where(eq(nxMediaFolders.id, id))
      .limit(1);

    if (!folder) {
      throw new NxNotFoundError("media-folder", id);
    }

    const [mediaCount] = await db
      .select({ total: count() })
      .from(nxMedia)
      .where(and(eq(nxMedia.folderId, id), isNull(nxMedia.deletedAt)));

    if (Number(mediaCount.total) > 0) {
      throw new NxConflictError("Folder contains media files");
    }

    const [childCount] = await db
      .select({ total: count() })
      .from(nxMediaFolders)
      .where(eq(nxMediaFolders.parentId, id));

    if (Number(childCount.total) > 0) {
      throw new NxConflictError("Folder has child folders");
    }

    await db.delete(nxMediaFolders).where(eq(nxMediaFolders.id, id));

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
