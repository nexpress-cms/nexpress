import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { listDocumentRevisions, parseRevisionListOptions } from "@/lib/revision-helpers";

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

    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
