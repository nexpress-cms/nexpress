import {
  NpForbiddenError,
  promoteMemberDocument,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";
import { revalidateCollection } from "@/lib/revalidate";

/**
 * Promote a member-authored `pending` document to `published`. The
 * core helper handles the status flip, the deferred reputation
 * credit (`document.created` was withheld at create time when the
 * row landed pending), and the audit trail. v1 is admin/editor/
 * moderator-gated — same surface that handles report resolution and
 * staff hide / restore on comments.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("document", "promote");
    }
    const { slug, id } = await context.params;
    const result = await promoteMemberDocument(slug, id, user.id);
    revalidateCollection(slug, result.doc);
    return npSuccessResponse(result.doc);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
