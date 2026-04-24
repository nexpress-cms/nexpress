import type { NextRequest } from "next/server";

import { requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { restoreDocumentRevision } from "@/lib/revision-helpers";
import { revalidateCollection } from "@/lib/revalidate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string; revisionId: string }> },
) {
  try {
    const { slug, id, revisionId } = await params;
    const user = await requireAuth(request);

    requireCsrf(request);

    const result = await restoreDocumentRevision(slug, id, revisionId, user);

    revalidateCollection(slug, result.doc);

    return nxSuccessResponse(result.doc);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
