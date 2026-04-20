import {
  NxForbiddenError,
  NxNotFoundError,
  hasRole,
  getMediaById,
  deleteMedia,
} from "@nexpress/core";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { optionalAuth, requireAuth, requireCsrf } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureCoreServices } from "@/lib/init-core";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await optionalAuth(request);
    ensureCoreServices();

    const media = await getMediaById(id);

    if (!media) {
      throw new NxNotFoundError("media", id);
    }

    return nxSuccessResponse(media);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireAuth(request);
    requireCsrf(request);

    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("media", "delete");
    }

    ensureCoreServices();

    const result = await deleteMedia(id);

    if (!result.deleted && result.references && result.references.length > 0) {
      return NextResponse.json(
        { error: "MEDIA_IN_USE", references: result.references },
        { status: 409 },
      );
    }

    if (!result.deleted) {
      throw new NxNotFoundError("media", id);
    }

    return nxSuccessResponse({ id, deleted: true });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
