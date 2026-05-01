import {
  NxForbiddenError,
  hasRole,
  purgeMemberContent,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

/**
 * Mass-delete every piece of content authored or uploaded by a
 * single member: comments, top-level docs in member-write
 * collections, and uploaded media. Admin-only — this is a
 * cross-collection sweep that needs full trust; mods who can
 * already hide / delete individual items go through the
 * existing per-target endpoints. CSRF + audit are recorded.
 *
 * Returns the per-bucket counts so the UI can show "deleted X
 * comments, Y discussions, Z media files" rather than a flat
 * total.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!hasRole(user, "admin")) {
      throw new NxForbiddenError("member.content", "purge");
    }
    const { id } = await context.params;
    const result = await purgeMemberContent(id, user);
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
