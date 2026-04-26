import {
  NxValidationError,
  assertNotBanned,
  getStorageAdapter,
  nxMedia,
  runHook,
  uploadMedia,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";
import { requireMember, requireMemberCsrf } from "@/lib/member-auth-helpers";

/**
 * Member-side image upload (Phase 9.7j). The discussion form's
 * rich-text editor calls this when a member inserts an image —
 * staff hit `/api/media/upload` (which requires editor role and
 * accepts a wider range of file types and sizes).
 *
 * Differences from the staff endpoint:
 *   - images-only (no PDFs / videos) — keeps the surface area
 *     bounded for unverified content
 *   - 5 MB cap (vs the staff 10 MB) — most member uploads are
 *     thumbnail-sized
 *   - banned-member check before the network round-trip
 *   - no folder argument (members don't see the media library)
 *   - `uploadMedia` stamps `uploaded_by_member_id` instead of
 *     `uploaded_by`
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function isAllowedMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const member = await requireMember(request);
    requireMemberCsrf(request);

    // Banned members can't upload, even if their session is still
    // live. The check is the same one the comment + doc-create
    // paths run.
    await assertNotBanned(member.id);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new NxValidationError("Invalid input", [
        { field: "file", message: "A file upload is required" },
      ]);
    }

    if (!isAllowedMimeType(file.type)) {
      throw new NxValidationError("Invalid input", [
        { field: "file", message: "Only image uploads are accepted" },
      ]);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new NxValidationError("Invalid input", [
        {
          field: "file",
          message: `File exceeds max size of ${MAX_FILE_SIZE} bytes`,
        },
      ]);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadMedia(
      { buffer, originalFilename: file.name, mimeType: file.type },
      { kind: "member", memberId: member.id },
    );

    // Look up the stored row to get its `storageKey` and resolve a
    // public URL through the storage adapter — local-disk returns a
    // `/uploads/...` path; S3 returns the bucket's public URL. The
    // editor inserts this URL as the `<img src>` so the same value
    // works in both deployment modes.
    const db = getDb();
    const [row] = (await db
      .select({ storageKey: nxMedia.storageKey })
      .from(nxMedia)
      .where(eq(nxMedia.id, result.id))
      .limit(1)) as Array<{ storageKey: string }>;
    const url = row ? await getStorageAdapter().getUrl(row.storageKey) : null;

    await runHook("media:afterUpload", {
      // Plugins typing on this hook still expect a `user` shape
      // for the actor. Pass null for the staff fields and let
      // hook authors that care about member uploads check the
      // member-keyed media row directly. (Hook surface widens
      // in a follow-up alongside `config.hooks.beforeCreate` for
      // member writes.)
      user: null,
      member: { id: member.id, handle: member.handle },
      media: result,
    });

    return nxSuccessResponse({ ...result, url }, { status: 202 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
