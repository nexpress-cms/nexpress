import { getCollectionConfig } from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { optionalAuth, requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import {
  extractSaveOptions,
  findCollectionDocuments,
  parseBodyRecord,
  parseFindOptions,
  saveCollectionDocument,
} from "@/lib/collection-helpers";
import { ensureCoreServices } from "@/lib/init-core";
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
    const user = await requireAuth(request);

    requireCsrf(request);

    const data = parseBodyRecord(await readJsonBody(request));
    const saveOptions = extractSaveOptions(data);
    const result = await saveCollectionDocument(slug, null, data, user, saveOptions);

    revalidateCollection(slug, result.doc);

    return nxSuccessResponse(result.doc, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
