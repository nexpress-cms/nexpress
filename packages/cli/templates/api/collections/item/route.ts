import { NpNotFoundError, NpValidationError } from "@nexpress/core";
import { NextResponse, type NextRequest } from "next/server";

import { optionalAuth, requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import {
  deleteCollectionDocument,
  getCollectionDocument,
  saveCollectionDocument,
} from "@/lib/collection-helpers";
import { revalidateCollection } from "@/lib/revalidate";

function parseBodyRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NpValidationError("Invalid input", [
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
    if (!document) throw new NpNotFoundError(slug, id);
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
    const user = await requireAuth(request);
    requireCsrf(request);
    const data = parseBodyRecord(await request.json());
    const previous = await getCollectionDocument(slug, id, user);
    const result = await saveCollectionDocument(slug, id, data, user);
    revalidateCollection(slug, result.doc);
    if (previous && previous.slug !== result.doc.slug) {
      revalidateCollection(slug, previous);
    }
    return npSuccessResponse(result.doc);
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
    const user = await requireAuth(request);
    requireCsrf(request);
    const previous = await getCollectionDocument(slug, id, user);
    await deleteCollectionDocument(slug, id, user);
    revalidateCollection(slug, previous);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
