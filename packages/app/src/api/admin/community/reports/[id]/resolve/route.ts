import { can, NpForbiddenError, resolveReport } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

interface ResolveBody {
  resolution?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NpForbiddenError("reports", "resolve");
    }

    const { id } = await params;
    const body = (await readJsonBody(request).catch(() => null)) as ResolveBody | null;
    const resolution = typeof body?.resolution === "string" ? body.resolution : "";

    const row = await resolveReport({
      reportId: id,
      resolution,
      actor: { kind: "staff", user },
    });

    return npSuccessResponse(row);
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
