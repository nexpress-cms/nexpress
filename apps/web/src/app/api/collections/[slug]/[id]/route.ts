import { NxNotFoundError, getCollectionConfig } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import { NextResponse, type NextRequest } from "next/server";

import { optionalAuth, requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import {
  deleteCollectionDocument,
  extractSaveOptions,
  getCollectionDocument,
  parseBodyRecord,
  saveCollectionDocument,
} from "@/lib/collection-helpers";
import { ensureCoreServices } from "@/lib/init-core";
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
      ensureCoreServices();
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
    const user = await requireAuth(request);

    requireCsrf(request);

    const data = parseBodyRecord(await readJsonBody(request));
    const saveOptions = extractSaveOptions(data);
    const previous = await getCollectionDocument(slug, id, user);
    const result = await saveCollectionDocument(slug, id, data, user, saveOptions);

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
    const user = await requireAuth(request);

    requireCsrf(request);
    const previous = await getCollectionDocument(slug, id, user);
    await deleteCollectionDocument(slug, id, user);

    revalidateCollection(slug, previous);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
