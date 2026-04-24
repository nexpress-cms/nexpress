import { invalidateAllSessions, runHook } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { clearAuthCookies, optionalAuth } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensurePluginsLoaded } from "@/lib/init-core";

export async function POST(request: NextRequest) {
  try {
    const user = await optionalAuth(request);

    if (user) {
      await ensurePluginsLoaded();
      await runHook("auth:beforeLogout", {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      });
      await invalidateAllSessions(user.id, getDb());
    }

    const response = nxSuccessResponse({ success: true });
    clearAuthCookies(response);

    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
