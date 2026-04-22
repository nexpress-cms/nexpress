import type { NextRequest } from "next/server";

import { optionalAuth, requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import {
  extractSaveOptions,
  findCollectionDocuments,
  parseBodyRecord,
  parseFindOptions,
  saveCollectionDocument,
} from "@/lib/collection-helpers";
import { revalidateCollection } from "@/lib/revalidate";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const user = await optionalAuth(request);
    const result = await findCollectionDocuments(
      slug,
      parseFindOptions(request.nextUrl.searchParams),
      user,
    );

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

    const data = parseBodyRecord(await request.json());
    const saveOptions = extractSaveOptions(data);
    const result = await saveCollectionDocument(slug, null, data, user, saveOptions);

    revalidateCollection(slug, result.doc);

    return nxSuccessResponse(result.doc, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
