import type { NextRequest } from "next/server";

import { requireAuth } from "../../../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import {
  listDocumentRevisions,
  parseRevisionListOptions,
} from "../../../../../lib/revision-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await params;
    const user = await requireAuth(request);
    const result = await listDocumentRevisions(
      slug,
      id,
      parseRevisionListOptions(request.nextUrl.searchParams),
      user,
    );

    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
