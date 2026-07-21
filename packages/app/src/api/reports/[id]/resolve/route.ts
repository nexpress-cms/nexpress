import { resolveReport } from "@nexpress/core/community";
import {
  npRequireCommunityId,
  npRequireResolveReportRequest,
  npToReportWireRow,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { npRequireCommunityRequest } from "../../../../lib/community-contract";
import { ensureFor } from "../../../../lib/init-core";
import { requireMember } from "../../../../lib/member-auth-helpers";
import { revalidateCollection } from "../../../../lib/revalidate";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const { id } = await params;
    const reportId = npRequireCommunityRequest(
      (value) => npRequireCommunityId(value, "community.resolveReport.id"),
      id,
    );
    const { action } = npRequireCommunityRequest(
      npRequireResolveReportRequest,
      await readJsonBody(request),
    );
    const result = await resolveReport({
      reportId,
      action,
      actor: { kind: "member", memberId: member.id },
    });
    if (result.moderatedDocument) {
      await revalidateCollection(
        result.moderatedDocument.collectionSlug,
        result.moderatedDocument.document,
      );
    }
    return npSuccessResponse(npToReportWireRow(result.report));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
