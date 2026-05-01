import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";

import {
  NxForbiddenError,
  NxValidationError,
  nxMedia,
  nxMediaFolders,
  runHook,
  uploadMedia,
  getStorageAdapter,
  can,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function isAllowedMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType === "application/pdf"
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("media", "upload");
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new NxValidationError("Invalid input", [
        { field: "file", message: "A file upload is required" },
      ]);
    }

    if (!isAllowedMimeType(file.type)) {
      throw new NxValidationError("Invalid input", [
        { field: "file", message: "Unsupported file type" },
      ]);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new NxValidationError("Invalid input", [
        { field: "file", message: `File exceeds max size of ${MAX_FILE_SIZE} bytes` },
      ]);
    }

    const folderIdRaw = formData.get("folderId");
    const folderId =
      typeof folderIdRaw === "string" && folderIdRaw.trim()
        ? folderIdRaw.trim()
        : undefined;

    await ensureWriteReady();
    const db = getDb();

    if (folderId) {
      const [folder] = await db
        .select({ id: nxMediaFolders.id })
        .from(nxMediaFolders)
        .where(eq(nxMediaFolders.id, folderId))
        .limit(1);

      if (!folder) {
        throw new NxValidationError("Invalid input", [
          { field: "folderId", message: "Folder not found" },
        ]);
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    await runHook("media:beforeUpload", {
      user: { id: user.id, email: user.email, role: user.role },
      file: {
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      },
      folderId,
    });

    if (file.type.startsWith("image/")) {
      const result = await uploadMedia(
        { buffer, originalFilename: file.name, mimeType: file.type },
        user.id,
        folderId,
      );

      await runHook("media:afterUpload", {
        user: { id: user.id, email: user.email, role: user.role },
        media: result,
      });

      return nxSuccessResponse(result, { status: 202 });
    }

    const id = randomUUID();
    const ext = extname(file.name).slice(1).toLowerCase() || "bin";
    const storageKey = `media/${id}/original.${ext}`;
    const now = new Date();

    await getStorageAdapter().upload(storageKey, buffer, {
      contentType: file.type,
      contentLength: buffer.byteLength,
      originalFilename: file.name,
    });

    await db.insert(nxMedia).values({
      id,
      filename: file.name,
      originalFilename: file.name,
      mimeType: file.type,
      filesize: file.size,
      storageKey,
      hash: createHash("sha256").update(buffer).digest("hex"),
      status: "ready",
      folderId: folderId ?? null,
      uploadedBy: user.id,
      createdAt: now,
      updatedAt: now,
    });

    await runHook("media:afterUpload", {
      user: { id: user.id, email: user.email, role: user.role },
      media: {
        id,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        storageKey,
      },
    });

    return nxSuccessResponse({ id, status: "ready" }, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
