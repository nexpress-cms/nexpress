import {
  NpForbiddenError,
  NpValidationError,
  npMediaFolders,
  uploadMedia,
  can,
} from "@nexpress/core";
import { runHook } from "@nexpress/core/bootstrap";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function isAllowedMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType === "application/pdf"
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const principal = { kind: "staff", user } as const;

    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("media", "upload");
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new NpValidationError("Invalid input", [
        { field: "file", message: "A file upload is required" },
      ]);
    }

    if (!isAllowedMimeType(file.type)) {
      throw new NpValidationError("Invalid input", [
        { field: "file", message: "Unsupported file type" },
      ]);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new NpValidationError("Invalid input", [
        { field: "file", message: `File exceeds max size of ${MAX_FILE_SIZE} bytes` },
      ]);
    }

    const folderIdRaw = formData.get("folderId");
    const folderId =
      typeof folderIdRaw === "string" && folderIdRaw.trim() ? folderIdRaw.trim() : undefined;

    await ensureFor("write");
    const db = getDb();

    if (folderId) {
      const [folder] = await db
        .select({ id: npMediaFolders.id })
        .from(npMediaFolders)
        .where(eq(npMediaFolders.id, folderId))
        .limit(1);

      if (!folder) {
        throw new NpValidationError("Invalid input", [
          { field: "folderId", message: "Folder not found" },
        ]);
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    await runHook("media:beforeUpload", {
      principal,
      member: null,
      file: {
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      },
      folderId: folderId ?? null,
    });

    const result = await uploadMedia(
      { buffer, originalFilename: file.name, mimeType: file.type },
      user.id,
      folderId,
    );

    await runHook("media:afterUpload", {
      principal,
      member: null,
      media: {
        id: result.id,
        status: result.status,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        folderId: folderId ?? null,
      },
    });

    return npSuccessResponse(result, {
      status: result.status === "processing" ? 202 : 201,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
