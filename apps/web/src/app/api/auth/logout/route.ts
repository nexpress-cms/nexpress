import { invalidateAllSessions } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { clearAuthCookies, optionalAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const user = await optionalAuth(request);

    if (user) {
      await invalidateAllSessions(user.id, getDb());
    }

    const response = nxSuccessResponse({ success: true });
    clearAuthCookies(response);

    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
