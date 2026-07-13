import { NpForbiddenError, purgeMemberContent, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

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
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireGlobalAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("member.content", "purge");
    }
    const { id } = await context.params;
    const result = await purgeMemberContent(id, user);
    return npSuccessResponse(result);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
