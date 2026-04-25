import { consumeMemberEmailVerifyToken } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const body = (await request.json()) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const result = await consumeMemberEmailVerifyToken(getDb(), token);
    return nxSuccessResponse({
      memberId: result.memberId,
      handle: result.handle,
      email: result.email,
    });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
