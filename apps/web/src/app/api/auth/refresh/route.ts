import { NpAuthError, signToken, verifyTokenFull } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { getAuthRuntimeConfig, setAuthCookies } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get("np-refresh")?.value;

    if (!refreshToken) {
      throw new NpAuthError();
    }

    const db = getDb();
    const config = getAuthRuntimeConfig();
    // Require `use: "refresh"`. An access JWT presented here gets
    // rejected — without this, a session cookie value would
    // successfully drive rotation and extend its own life
    // indefinitely.
    const user = await verifyTokenFull(refreshToken, config.secret, db, "refresh");

    if (!user) {
      throw new NpAuthError();
    }

    const response = npSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    setAuthCookies(response, {
      access: await signToken(user, config.secret, config.tokenExpiration, "access"),
      refresh: await signToken(user, config.secret, config.refreshTokenExpiration, "refresh"),
      csrf: crypto.randomUUID(),
    });

    return response;
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
