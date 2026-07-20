import { NpNotFoundError, NpValidationError } from "@nexpress/core";
import { runHook } from "@nexpress/core/bootstrap";
import { withMemberWrite } from "@nexpress/core/community";
import {
  getMediaById,
  npInspectMediaAttachmentUpload,
  npToMediaAttachmentWire,
  uploadMedia,
} from "@nexpress/core/media";
import { npMediaAttachmentLimits } from "@nexpress/core/media-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";
import { requireMember } from "../../../../lib/member-auth-helpers";

const maxMultipartRequestBytes = npMediaAttachmentLimits.maxFileSizeBytes + 64 * 1024;

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const result = await withMemberWrite(member.id, [], async () => {
      validateContentLength(request.headers.get("content-length"));
      const formData = await readExactAttachmentFormData(request);
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new NpValidationError("Invalid input", [
          { field: "file", message: "A file upload is required" },
        ]);
      }
      if (file.size === 0 || file.size > npMediaAttachmentLimits.maxFileSizeBytes) {
        throw new NpValidationError("Invalid input", [
          {
            field: "file",
            message:
              file.size === 0
                ? "Empty files are not accepted."
                : `File exceeds max size of ${npMediaAttachmentLimits.maxFileSizeBytes.toString()} bytes.`,
          },
        ]);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const inspected = npInspectMediaAttachmentUpload(file.name, file.type, buffer);
      if (!inspected.ok) {
        throw new NpValidationError("Invalid input", [
          { field: "file", message: inspected.message },
        ]);
      }

      const principal = { kind: "member", memberId: member.id } as const;
      await runHook("media:beforeUpload", {
        principal,
        member: {
          id: member.id,
          email: member.email,
          handle: member.handle,
          displayName: member.displayName,
        },
        file: {
          filename: inspected.filename,
          mimeType: inspected.mimeType,
          size: buffer.byteLength,
        },
        folderId: null,
      });

      const uploaded = await uploadMedia(
        {
          buffer,
          originalFilename: inspected.filename,
          mimeType: inspected.mimeType,
        },
        { kind: "member", memberId: member.id },
      );
      const media = await getMediaById(uploaded.id);
      if (!media) throw new NpNotFoundError("media", uploaded.id);

      await runHook("media:afterUpload", {
        principal,
        member: {
          id: member.id,
          email: member.email,
          handle: member.handle,
          displayName: member.displayName,
        },
        media: {
          id: uploaded.id,
          status: uploaded.status,
          filename: inspected.filename,
          mimeType: inspected.mimeType,
          size: buffer.byteLength,
          folderId: null,
        },
      });
      return npToMediaAttachmentWire(media);
    });

    return npSuccessResponse(result, { status: 202 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function validateContentLength(value: string | null): void {
  if (value === null) return;
  if (!/^[0-9]+$/u.test(value) || Number(value) > maxMultipartRequestBytes) {
    throw new NpValidationError("Invalid input", [
      {
        field: "file",
        message: `Multipart request exceeds max size of ${maxMultipartRequestBytes.toString()} bytes.`,
      },
    ]);
  }
}

async function readExactAttachmentFormData(request: NextRequest): Promise<FormData> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new NpValidationError("Invalid input", [
      { field: "file", message: "A valid multipart file upload is required." },
    ]);
  }
  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "file") {
    throw new NpValidationError("Invalid input", [
      { field: "file", message: "Submit exactly one file field and no other fields." },
    ]);
  }
  return formData;
}
