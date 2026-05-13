import {
  NpForbiddenError,
  NpNotFoundError,
  getMediaById,
  deleteMedia,
  can,
} from "@nexpress/core";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // Admin-library detail. The public site reads media by id
    // server-side via `getMediaById`; anonymous clients don't need the
    // raw metadata. Require an editor session — symmetric with the
    // list endpoint (#73).
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("media", "read");
    }
    await ensureFor("read");

    const media = await getMediaById(id);

    if (!media) {
      throw new NpNotFoundError("media", id);
    }

    return npSuccessResponse(media);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireAuth(request);

    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("media", "delete");
    }

    await ensureFor("read");

    const result = await deleteMedia(id);

    if (!result.deleted && result.references && result.references.length > 0) {
      return NextResponse.json(
        { error: "MEDIA_IN_USE", references: result.references },
        { status: 409 },
      );
    }

    if (!result.deleted) {
      throw new NpNotFoundError("media", id);
    }

    return npSuccessResponse({ id, deleted: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
