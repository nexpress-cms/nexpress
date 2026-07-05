import {
  NpValidationError,
  assertNotBanned,
  getStorageAdapter,
  npMedia,
  runHook,
  uploadMedia,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { getDb } from "../../../../lib/db";
import { ensureFor } from "../../../../lib/init-core";
import { requireMember } from "../../../../lib/member-auth-helpers";

/**
 * Member-side image upload (Phase 9.7j). The discussion form's
 * rich-text editor calls this when a member inserts an image —
 * staff hit `/api/media/upload` (which requires editor role and
 * accepts a wider range of file types and sizes).
 *
 * Differences from the staff endpoint:
 *   - raster-images-only (no SVG, PDFs, videos) — SVG is active
 *     content (XSS vector when served from /uploads), so member
 *     uploads are restricted to the four raster MIMEs we can
 *     reliably sniff via magic bytes
 *   - 5 MB cap (vs the staff 10 MB) — most member uploads are
 *     thumbnail-sized
 *   - banned-member check before the network round-trip
 *   - no folder argument (members don't see the media library)
 *   - `uploadMedia` stamps `uploaded_by_member_id` instead of
 *     `uploaded_by`
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Read the buffer's magic bytes and return the implied MIME type,
 * or `null` when the bytes don't match any of our raster
 * allow-list. Catching mismatches is essential because the
 * client-supplied `File.type` value is trivially spoofable —
 * an attacker can submit an SVG or HTML payload labeled
 * `image/png` and the storage adapter would write the bytes
 * verbatim with a `Content-Type: image/png` header.
 */
function sniffImageMime(buffer: Buffer): AllowedMimeType | null {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF87a / GIF89a: "GIF87a" / "GIF89a"
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const principal = { kind: "member", memberId: member.id } as const;

    // Banned members can't upload, even if their session is still
    // live. The check is the same one the comment + doc-create
    // paths run.
    await assertNotBanned(member.id);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new NpValidationError("Invalid input", [
        { field: "file", message: "A file upload is required" },
      ]);
    }

    if (!isAllowedMimeType(file.type)) {
      throw new NpValidationError("Invalid input", [
        {
          field: "file",
          message: `Only image uploads are accepted (${ALLOWED_MIME_TYPES.join(", ")})`,
        },
      ]);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new NpValidationError("Invalid input", [
        {
          field: "file",
          message: `File exceeds max size of ${MAX_FILE_SIZE} bytes`,
        },
      ]);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Verify the bytes actually match the claimed MIME. Without this
    // a client can hand us a `<svg onload=…>` blob labelled
    // `image/png` and we would happily store + serve it under the
    // `image/png` Content-Type — modern browsers honor the response
    // header for top-level navigation, but `<img src>` requests
    // sniff the body and would render the SVG, opening a stored
    // XSS vector for any member who inserts a "bad" image into a
    // discussion. Reject the upload before storage.
    const sniffedMime = sniffImageMime(buffer);
    if (!sniffedMime || sniffedMime !== file.type) {
      throw new NpValidationError("Invalid input", [
        {
          field: "file",
          message:
            "File contents don't match the declared image type — only PNG, JPEG, WebP, and GIF are supported.",
        },
      ]);
    }

    await runHook("media:beforeUpload", {
      user: null,
      principal,
      member: {
        id: member.id,
        email: member.email,
        handle: member.handle,
        displayName: member.displayName,
      },
      file: {
        filename: file.name,
        mimeType: sniffedMime,
        size: file.size,
      },
    });

    const result = await uploadMedia(
      { buffer, originalFilename: file.name, mimeType: sniffedMime },
      { kind: "member", memberId: member.id },
    );

    // Look up the stored row to get its `storageKey` and resolve a
    // public URL through the storage adapter — local-disk returns a
    // `/uploads/...` path; S3 returns the bucket's public URL. The
    // editor inserts this URL as the `<img src>` so the same value
    // works in both deployment modes.
    const db = getDb();
    const [row] = (await db
      .select({ storageKey: npMedia.storageKey })
      .from(npMedia)
      .where(eq(npMedia.id, result.id))
      .limit(1)) as Array<{ storageKey: string }>;
    const url = row ? await getStorageAdapter().getUrl(row.storageKey) : null;

    await runHook("media:afterUpload", {
      user: null,
      principal,
      member: {
        id: member.id,
        email: member.email,
        handle: member.handle,
        displayName: member.displayName,
      },
      media: result,
    });

    return npSuccessResponse({ ...result, url }, { status: 202 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
