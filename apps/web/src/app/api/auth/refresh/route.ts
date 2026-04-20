import { NxAuthError, signToken, verifyTokenFull } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { getAuthRuntimeConfig, setAuthCookies } from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get("nx-refresh")?.value;

    if (!refreshToken) {
      throw new NxAuthError();
    }

    const db = getDb();
    const config = getAuthRuntimeConfig();
    const user = await verifyTokenFull(refreshToken, config.secret, db);

    if (!user) {
      throw new NxAuthError();
    }

    const response = nxSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    setAuthCookies(response, {
      access: await signToken(user, config.secret, config.tokenExpiration),
      refresh: await signToken(user, config.secret, config.refreshTokenExpiration),
      csrf: crypto.randomUUID(),
    });

    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
