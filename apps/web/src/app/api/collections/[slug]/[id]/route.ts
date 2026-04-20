import { NxNotFoundError, NxValidationError } from "@nexpress/core";
import { NextResponse, type NextRequest } from "next/server";

import { optionalAuth, requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import {
  deleteCollectionDocument,
  getCollectionDocument,
  saveCollectionDocument,
} from "@/lib/collection-helpers";

function parseBodyRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be a JSON object" },
    ]);
  }

  return body as Record<string, unknown>;
}

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

    const data = parseBodyRecord(await request.json());
    const result = await saveCollectionDocument(slug, id, data, user);

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
    await deleteCollectionDocument(slug, id, user);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
