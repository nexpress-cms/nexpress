import { npWithAgentGuardianHttpResponseV1 } from "../../lib/agents/guardian-http-observer";
import { fileReport } from "@nexpress/core/community";
import { npRequireReportRequest, npToReportWireRow } from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { npRequireCommunityRequest } from "../../lib/community-contract";
import { requireMember } from "../../lib/member-auth-helpers";

async function npGuardianPOST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { targetType, targetId, reason } = npRequireCommunityRequest(
      npRequireReportRequest,
      await readJsonBody(request),
    );
    const row = await fileReport({
      reporterId: member.id,
      targetType,
      targetId,
      reason,
    });
    return npSuccessResponse(npToReportWireRow(row), { status: 201 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const POST = npWithAgentGuardianHttpResponseV1("reports", npGuardianPOST);
