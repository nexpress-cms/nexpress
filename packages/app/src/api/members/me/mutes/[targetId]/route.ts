import { unmuteMember } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../lib/api-response";
import { requireMember } from "../../../../../lib/member-auth-helpers";
import { ensureFor } from "../../../../../lib/init-core";

/**
 * Phase 16.1 — unmute a previously muted target. Idempotent:
 * unmuting someone who isn't currently muted returns
 * `{ ok: true, removed: false }` rather than 404 so the
 * client doesn't have to refetch the list before deleting.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ targetId: string }> },
) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { targetId } = await context.params;
    const removed = await unmuteMember({ memberId: member.id, targetId });
    return npSuccessResponse({ ok: true, removed });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
