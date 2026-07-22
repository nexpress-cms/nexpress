import {
  NpAuthError,
  NpForbiddenError,
  NpNotFoundError,
  deleteMemberDocument,
  getCollectionConfig,
  updateMemberDocument,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { NextResponse, type NextRequest } from "next/server";

import { optionalAuth } from "../../../../lib/auth-helpers";
import { validateDocumentBlockContent } from "../../../../lib/block-content-validation";
import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import {
  deleteCollectionDocument,
  extractSaveOptions,
  getCollectionDocument,
  npSerializeCollectionDocumentForApi,
  parseBodyRecord,
  saveCollectionDocument,
} from "../../../../lib/collection-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { optionalMember } from "../../../../lib/member-auth-helpers";
import { npCanReadCommunityDocument } from "@nexpress/core/community";
import { revalidateCollection } from "../../../../lib/revalidate";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await params;
    const user = await optionalAuth(request);
    const member = user ? null : await optionalMember(request);
    const document = await getCollectionDocument(slug, id, user);

    if (!document) {
      throw new NpNotFoundError(slug, id);
    }

    // Anonymous callers must not see non-published rows for collections
    // that opt into draft workflows (#56). 404 on draft / scheduled /
    // archived to keep enumeration consistent with the listing route.
    if (!user) {
      await ensureFor("read");
      const config = getCollectionConfig(slug);
      if (
        config.versions?.drafts &&
        document.status !== "published" &&
        config.community?.audience !== true
      ) {
        throw new NpNotFoundError(slug, id);
      }
      if (
        config.community?.audience === true &&
        !(await npCanReadCommunityDocument(
          config,
          document,
          member ? { kind: "member", memberId: member.id } : null,
          { allowUnpublished: true },
        ))
      ) {
        throw new NpNotFoundError(slug, id);
      }
    }

    return npSuccessResponse(document);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await params;

    // Two auth surfaces (Phase 9.7b):
    //   1. Staff session → standard `saveCollectionDocument` path,
    //      gated by the collection's `access.update` access function.
    //   2. Member session → only valid when the collection opted into
    //      `community.memberWrite.update` AND the row's
    //      `member_author_id` matches the caller. Goes through
    //      `updateMemberDocument`, which also strips `_status`
    //      from the body so members can't transition status.
    // Staff takes precedence when both are present.
    const staffUser = await optionalAuth(request);
    if (staffUser) {
      const data = parseBodyRecord(await readJsonBody(request));
      const saveOptions = extractSaveOptions(data);
      const previous = await getCollectionDocument(slug, id, staffUser);
      const result = await saveCollectionDocument(slug, id, data, staffUser, saveOptions);

      await revalidateCollection(slug, result.doc);
      if (previous && previous.slug !== result.doc.slug) {
        await revalidateCollection(slug, previous);
      }
      return npSuccessResponse(result.doc);
    }

    const member = await optionalMember(request);
    if (!member) throw new NpAuthError();

    await ensureFor("read");
    const config = getCollectionConfig(slug);
    if (!config.community?.memberWrite?.update) {
      throw new NpForbiddenError(slug, "update");
    }

    await ensureFor("write");
    const data = parseBodyRecord(await readJsonBody(request));
    const saveOptions = extractSaveOptions(data);
    await validateDocumentBlockContent(slug, data);
    const previous = await getCollectionDocument(slug, id, null);
    const result = await updateMemberDocument(slug, id, data, member.id, saveOptions);

    await revalidateCollection(slug, result.doc);
    if (previous && previous.slug !== result.doc.slug) {
      await revalidateCollection(slug, previous);
    }
    return npSuccessResponse(npSerializeCollectionDocumentForApi(slug, result.doc));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await params;

    const staffUser = await optionalAuth(request);
    if (staffUser) {
      const previous = await getCollectionDocument(slug, id, staffUser);
      await deleteCollectionDocument(slug, id, staffUser);
      await revalidateCollection(slug, previous);
      return new NextResponse(null, { status: 204 });
    }

    const member = await optionalMember(request);
    if (!member) throw new NpAuthError();

    await ensureFor("read");
    const config = getCollectionConfig(slug);
    if (!config.community?.memberWrite?.delete) {
      throw new NpForbiddenError(slug, "delete");
    }

    await ensureFor("write");
    const previous = await getCollectionDocument(slug, id, null);
    await deleteMemberDocument(slug, id, member.id);
    await revalidateCollection(slug, previous);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
