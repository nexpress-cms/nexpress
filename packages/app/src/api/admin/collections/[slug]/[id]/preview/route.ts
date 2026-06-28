import { NpNotFoundError, NpValidationError, getCollectionConfig } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { getCollectionDocument } from "../../../../../../lib/collection-helpers";
import { resolveCollectionPreviewPath } from "../../../../../../lib/collection-preview";
import { ensureFor } from "../../../../../../lib/init-core";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    const { slug, id } = await context.params;
    const config = getCollectionConfig(slug);
    const doc = await getCollectionDocument(slug, id, user);

    if (!doc) {
      throw new NpNotFoundError(slug, id);
    }

    const path = resolveCollectionPreviewPath(config, doc);
    if (!path) {
      throw new NpValidationError("Preview is unavailable for this document.", [
        {
          field: "path",
          message: "Collection does not define a safe public preview path for this document.",
        },
      ]);
    }

    return npSuccessResponse({
      path,
      href: `/api/preview?path=${encodeURIComponent(path)}`,
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
