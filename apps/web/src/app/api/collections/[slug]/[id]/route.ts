import {
  NxAuthError,
  NxForbiddenError,
  NxNotFoundError,
  deleteMemberDocument,
  getCollectionConfig,
  updateMemberDocument,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { NextResponse, type NextRequest } from "next/server";

import { optionalAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import {
  deleteCollectionDocument,
  extractSaveOptions,
  getCollectionDocument,
  parseBodyRecord,
  saveCollectionDocument,
} from "@/lib/collection-helpers";
import { ensureFor } from "@/lib/init-core";
import { optionalMember } from "@/lib/member-auth-helpers";
import { revalidateCollection } from "@/lib/revalidate";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await params;
    const user = await optionalAuth(request);
    const document = await getCollectionDocument(slug, id, user);

    if (!document) {
      throw new NxNotFoundError(slug, id);
    }

    // Anonymous callers must not see non-published rows for collections
    // that opt into draft workflows (#56). 404 on draft / scheduled /
    // archived to keep enumeration consistent with the listing route.
    if (!user) {
      await ensureFor("read");
      const config = getCollectionConfig(slug);
      if (config.versions?.drafts && document.status !== "published") {
        throw new NxNotFoundError(slug, id);
      }
    }

    return nxSuccessResponse(document);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
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

      revalidateCollection(slug, result.doc);
      if (previous && previous.slug !== result.doc.slug) {
        revalidateCollection(slug, previous);
      }
      return nxSuccessResponse(result.doc);
    }

    const member = await optionalMember(request);
    if (!member) throw new NxAuthError();

    await ensureFor("read");
    const config = getCollectionConfig(slug);
    if (!config.community?.memberWrite?.update) {
      throw new NxForbiddenError(slug, "update");
    }

    await ensureFor("write");
    const data = parseBodyRecord(await readJsonBody(request));
    const saveOptions = extractSaveOptions(data);
    const previous = await getCollectionDocument(slug, id, null);
    const result = await updateMemberDocument(slug, id, data, member.id, saveOptions);

    revalidateCollection(slug, result.doc);
    if (previous && previous.slug !== result.doc.slug) {
      revalidateCollection(slug, previous);
    }
    return nxSuccessResponse(result.doc);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
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
      revalidateCollection(slug, previous);
      return new NextResponse(null, { status: 204 });
    }

    const member = await optionalMember(request);
    if (!member) throw new NxAuthError();

    await ensureFor("read");
    const config = getCollectionConfig(slug);
    if (!config.community?.memberWrite?.delete) {
      throw new NxForbiddenError(slug, "delete");
    }

    await ensureFor("write");
    const previous = await getCollectionDocument(slug, id, null);
    await deleteMemberDocument(slug, id, member.id);
    revalidateCollection(slug, previous);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
