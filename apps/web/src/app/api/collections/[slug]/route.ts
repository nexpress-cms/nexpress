import {
  NxAuthError,
  NxForbiddenError,
  createMemberDocument,
  getCollectionConfig,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { optionalAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import {
  extractSaveOptions,
  findCollectionDocuments,
  parseBodyRecord,
  parseFindOptions,
  saveCollectionDocument,
} from "@/lib/collection-helpers";
import { ensureCoreServices, ensureWriteReady } from "@/lib/init-core";
import { optionalMember, requireMemberCsrf } from "@/lib/member-auth-helpers";
import { revalidateCollection } from "@/lib/revalidate";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const user = await optionalAuth(request);
    const findOptions = parseFindOptions(request.nextUrl.searchParams);

    // Anonymous callers must not see drafts / scheduled / archived rows
    // — that's the rendered-site invariant. The public REST surface
    // was previously leaking them because the route applied no default
    // status filter (#56). For collections that opt into draft
    // workflows, force `where.status = "published"` for unauthenticated
    // requests. Authenticated callers (any staff role) can still
    // filter all statuses explicitly via `?where=`.
    if (!user) {
      ensureCoreServices();
      const config = getCollectionConfig(slug);
      if (config.versions?.drafts) {
        findOptions.where = { ...(findOptions.where ?? {}), status: "published" };
      }
    }

    const result = await findCollectionDocuments(slug, findOptions, user);

    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    // Two auth surfaces converge on this endpoint:
    //   1. Staff session (`nx-session`) → standard path through
    //      `saveCollectionDocument`, which honors `access.create`.
    //   2. Member session (`nx-mb-session`) → only valid when the
    //      collection opted into `community.memberWrite.create`;
    //      goes through `createMemberDocument`, which bypasses
    //      `access.create` and gates on `assertNotBanned` instead.
    // Staff takes precedence when both are present (admin browsing
    // signed in as a member should still be able to act as staff).
    const staffUser = await optionalAuth(request);
    if (staffUser) {
      requireCsrf(request);
      const data = parseBodyRecord(await readJsonBody(request));
      const saveOptions = extractSaveOptions(data);
      const result = await saveCollectionDocument(slug, null, data, staffUser, saveOptions);
      revalidateCollection(slug, result.doc);
      return nxSuccessResponse(result.doc, { status: 201 });
    }

    const member = await optionalMember(request);
    if (!member) throw new NxAuthError();

    ensureCoreServices();
    const config = getCollectionConfig(slug);
    if (!config.community?.memberWrite?.create) {
      // Surface as 403 not 401 — the member is authenticated; the
      // collection just hasn't opted in to member writes.
      throw new NxForbiddenError(slug, "create");
    }

    requireMemberCsrf(request);
    await ensureWriteReady();
    const data = parseBodyRecord(await readJsonBody(request));
    const saveOptions = extractSaveOptions(data);
    const result = await createMemberDocument(slug, data, member.id, saveOptions);
    revalidateCollection(slug, result.doc);
    return nxSuccessResponse(result.doc, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
