import { npWithAgentGuardianHttpResponseV1 } from "../../../../../../../lib/agents/guardian-http-observer";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../../../../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../../../../../lib/api-response";
import { restoreDocumentRevision } from "../../../../../../../lib/revision-helpers";
import { revalidateCollection } from "../../../../../../../lib/revalidate";
import { npSerializeCollectionDocumentForApi } from "../../../../../../../lib/collection-helpers";

async function npGuardianPOST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string; revisionId: string }> },
) {
  try {
    const { slug, id, revisionId } = await params;
    const user = await requireAuth(request);

    const result = await restoreDocumentRevision(slug, id, revisionId, user);

    await revalidateCollection(slug, result.doc);

    return npSuccessResponse(npSerializeCollectionDocumentForApi(slug, result.doc));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const POST = npWithAgentGuardianHttpResponseV1("collections", npGuardianPOST);
