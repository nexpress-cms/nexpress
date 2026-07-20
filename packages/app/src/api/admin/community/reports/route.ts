import { can, NpForbiddenError, NpValidationError } from "@nexpress/core";
import { getReportTargetContext, listReports } from "@nexpress/core/community";
import {
  npIsReportStatus,
  npIsReportTarget,
  npRequireModerationReportPageWire,
  npToReportWireRow,
} from "@nexpress/core/community-contract";
import type { NpModerationReportWireRow } from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { npReadCommunityPage } from "../../../../lib/community-contract";

export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("reports", "list");
    }

    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const targetType = params.get("targetType");
    if (status !== null && !npIsReportStatus(status)) {
      throw new NpValidationError("Invalid input", [
        { field: "status", message: "Must be unresolved, resolved, or all" },
      ]);
    }
    if (targetType !== null && !npIsReportTarget(targetType)) {
      throw new NpValidationError("Invalid input", [
        {
          field: "targetType",
          message: "Must be comment, member, or a canonical collection slug",
        },
      ]);
    }
    const { limit, page, offset } = npReadCommunityPage(params);

    const result = await listReports({
      status: status ?? "unresolved",
      targetType: targetType ?? undefined,
      limit,
      offset,
    });

    const totalPages = result.totalDocs === 0 ? 0 : Math.ceil(result.totalDocs / limit);

    const docs: NpModerationReportWireRow[] = [];
    for (let index = 0; index < result.reports.length; index += 10) {
      const batch = result.reports.slice(index, index + 10);
      docs.push(
        ...(await Promise.all(
          batch.map(async (report) => ({
            ...npToReportWireRow(report),
            target: await getReportTargetContext(report),
          })),
        )),
      );
    }

    return npSuccessResponse(
      npRequireModerationReportPageWire({
        docs,
        totalDocs: result.totalDocs,
        totalPages,
        page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1 && result.totalDocs > 0,
      }),
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
