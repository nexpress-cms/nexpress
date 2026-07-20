import { NpConflictError, NpNotFoundError } from "@nexpress/core";
import { withMemberWrite } from "@nexpress/core/community";
import { deleteMedia, getMediaById } from "@nexpress/core/media";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { ensureFor } from "../../../../../lib/init-core";
import { requireMember } from "../../../../../lib/member-auth-helpers";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    if (!uuidPattern.test(id)) throw new NpNotFoundError("media attachment", id);

    const media = await getMediaById(id);
    if (!media || media.uploadedByMemberId !== member.id) {
      throw new NpNotFoundError("media attachment", id);
    }

    await withMemberWrite(member.id, [], async () => {
      const result = await deleteMedia(id);
      if (!result.deleted && result.references && result.references.length > 0) {
        throw new NpConflictError(
          "Attached files must be removed from their post before deletion.",
          {
            referenceCount: result.references.length,
          },
        );
      }
      if (!result.deleted) throw new NpNotFoundError("media attachment", id);
    });

    return npSuccessResponse({ id, deleted: true });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
