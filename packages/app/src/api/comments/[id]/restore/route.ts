import { npWithAgentGuardianHttpResponseV1 } from "../../../../lib/agents/guardian-http-observer";
import { restoreComment } from "@nexpress/core/community";
import { npRequireOkWire } from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";
import { requireMember } from "../../../../lib/member-auth-helpers";

async function npGuardianPOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    await restoreComment({ commentId: id, memberId: member.id });
    return npSuccessResponse(npRequireOkWire({ ok: true }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const POST = npWithAgentGuardianHttpResponseV1("community", npGuardianPOST);
