import { consumeMemberPasswordReset } from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensureFor } from "@/lib/init-core";

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const body = (await readJsonBody(request)) as
      | { token?: unknown; password?: unknown }
      | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const result = await consumeMemberPasswordReset(getDb(), token, password);
    return nxSuccessResponse({ memberId: result.memberId, email: result.email });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
