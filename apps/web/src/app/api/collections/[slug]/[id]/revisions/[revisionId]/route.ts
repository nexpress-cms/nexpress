import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDocumentRevision } from "@/lib/revision-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string; revisionId: string }> },
) {
  try {
    const { slug, id, revisionId } = await params;
    const user = await requireAuth(request);
    const revision = await getDocumentRevision(slug, id, revisionId, user);

    return nxSuccessResponse(revision);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
