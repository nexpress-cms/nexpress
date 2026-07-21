import { NpNotFoundError, getDocumentById } from "@nexpress/core";
import type { NpPrincipal } from "@nexpress/core/auth";
import { npCanReadCommunityDocument } from "@nexpress/core/community";
import {
  getMediaById,
  getStorageAdapter,
  listMediaReferences,
  npIsSupportedMediaAttachment,
} from "@nexpress/core/media";
import { npGetStorageObjectStream, npStorageObjectExists } from "@nexpress/core/storage";
import type { NextRequest } from "next/server";

import { npErrorResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";
import { optionalMember } from "../../../../lib/member-auth-helpers";
import { optionalAuth } from "../../../../lib/auth-helpers";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function isReadableAttachmentReference(
  mediaId: string,
  principals: readonly (NpPrincipal | null)[],
): Promise<boolean> {
  const references = await listMediaReferences(mediaId, {
    field: "attachments.file",
    limit: 100,
  });
  for (const reference of references) {
    try {
      const document = await getDocumentById<Record<string, unknown>>(
        reference.collection,
        reference.documentId,
      );
      if (!document) continue;
      for (const principal of principals) {
        if (
          await npCanReadCommunityDocument(reference.collection, document, principal, {
            allowUnpublished: principal !== null,
          })
        ) {
          return true;
        }
      }
    } catch {
      // Inactive collections, denied rows, and malformed persisted documents fail closed.
    }
  }
  return false;
}

function contentDisposition(filename: string): string {
  const fallback =
    filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/gu, "_")
      .replace(/["\\]/gu, "_")
      .slice(0, 180) || "attachment";
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function handleDownload(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  includeBody: boolean,
): Promise<Response> {
  try {
    await ensureFor("read");
    const { id } = await params;
    if (!uuidPattern.test(id)) throw new NpNotFoundError("media attachment", id);
    const media = await getMediaById(id);
    if (!media || !npIsSupportedMediaAttachment(media)) {
      throw new NpNotFoundError("media attachment", id);
    }

    const [member, staff] = await Promise.all([optionalMember(request), optionalAuth(request)]);
    const isOwner = member !== null && media.uploadedByMemberId === member.id;
    const principals: Array<NpPrincipal | null> = [null];
    if (member) principals.push({ kind: "member", memberId: member.id });
    if (staff) principals.push({ kind: "staff", user: staff });
    if (!isOwner && !(await isReadableAttachmentReference(id, principals))) {
      throw new NpNotFoundError("media attachment", id);
    }

    const storage = getStorageAdapter();
    if (!(await npStorageObjectExists(storage, media.storageKey))) {
      throw new NpNotFoundError("media attachment", id);
    }

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(media.filename),
      "Content-Length": media.filesize.toString(),
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
      "Content-Type": media.mimeType,
      "X-Content-Type-Options": "nosniff",
    });
    if (!includeBody) return new Response(null, { status: 200, headers });
    const stream = await npGetStorageObjectStream(storage, media.storageKey);
    // Node's `stream/web` and the DOM lib expose structurally compatible
    // ReadableStreams but TypeScript models their async-iterator extensions
    // differently. Next's runtime accepts the validated storage stream.
    return new Response(stream as unknown as BodyInit, { status: 200, headers });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleDownload(request, context, true);
}

export function HEAD(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleDownload(request, context, false);
}
