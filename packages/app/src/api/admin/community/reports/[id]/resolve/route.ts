import { can, NpForbiddenError } from "@nexpress/core";
import { resolveReport } from "@nexpress/core/community";
import {
  npRequireCommunityId,
  npRequireResolveReportRequest,
  npToReportWireRow,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../../../lib/api-response";
import { requireAuth } from "../../../../../../lib/auth-helpers";
import { ensureFor } from "../../../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../../../lib/community-contract";
import { revalidateCollection } from "../../../../../../lib/revalidate";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("reports", "resolve");
    }

    const { id } = await params;
    const reportId = npRequireCommunityRequest(
      (value) => npRequireCommunityId(value, "community.resolveReport.id"),
      id,
    );
    const { action } = npRequireCommunityRequest(
      npRequireResolveReportRequest,
      await readJsonBody(request).catch(() => null),
    );

    const result = await resolveReport({
      reportId,
      action,
      actor: { kind: "staff", user },
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
