import { can, NpForbiddenError } from "@nexpress/core";
import { resolveReport } from "@nexpress/core/community";
import {
  npRequireResolveReportRequest,
  npToReportWireRow,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../../../lib/community-contract";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("reports", "resolve");
    }

    const { id } = await params;
    const { resolution } = npRequireCommunityRequest(
      npRequireResolveReportRequest,
      await readJsonBody(request).catch(() => null),
    );

    const row = await resolveReport({
      reportId: id,
      resolution,
      actor: { kind: "staff", user },
    });

    return npSuccessResponse(npToReportWireRow(row));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
