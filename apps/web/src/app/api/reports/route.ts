import { fileReport } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureFor } from "@/lib/init-core";
import { requireMember } from "@/lib/member-auth-helpers";

interface ReportBody {
  targetType?: unknown;
  targetId?: unknown;
  reason?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const body = (await readJsonBody(request)) as ReportBody | null;
    const targetType = typeof body?.targetType === "string" ? body.targetType : "";
    const targetId = typeof body?.targetId === "string" ? body.targetId : "";
    const reason = typeof body?.reason === "string" ? body.reason : "";
    const row = await fileReport({
      reporterId: member.id,
      targetType: targetType as "comment" | "thread" | "reply" | "member",
      targetId,
      reason,
    });
    return nxSuccessResponse(row, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
