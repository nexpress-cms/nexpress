import { unmuteMember } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireMember, requireMemberCsrf } from "@/lib/member-auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

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
    await ensureWriteReady();
    const member = await requireMember(request);
    requireMemberCsrf(request);
    const { targetId } = await context.params;
    const removed = await unmuteMember({ memberId: member.id, targetId });
    return nxSuccessResponse({ ok: true, removed });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
