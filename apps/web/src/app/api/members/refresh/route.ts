import { randomBytes } from "node:crypto";

import {
  NxAuthError,
  getMemberFromTokenPayload,
  signMemberToken,
  verifyMemberToken,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { nxErrorResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { getMemberAuthRuntimeConfig, setMemberAuthCookies } from "@/lib/member-auth-helpers";
import { ensureCoreServices } from "@/lib/init-core";

export async function POST(request: NextRequest) {
  try {
    ensureCoreServices();
    const refreshToken = request.cookies.get("nx-mb-refresh")?.value;
    if (!refreshToken) throw new NxAuthError();

    const { secret, tokenExpiration, refreshTokenExpiration } = getMemberAuthRuntimeConfig();
    const payload = await verifyMemberToken(refreshToken, secret);
    const member = await getMemberFromTokenPayload(getDb() as never, payload);
    if (!member || member.status !== "active") throw new NxAuthError();

    const access = await signMemberToken(member, secret, tokenExpiration);
    const refresh = await signMemberToken(member, secret, refreshTokenExpiration);
    const csrf = randomBytes(16).toString("hex");

    const response = NextResponse.json(
      {
        member: {
          id: member.id,
          handle: member.handle,
          email: member.email,
          displayName: member.displayName,
        },
      },
      { status: 200 },
    );
    setMemberAuthCookies(response, { access, refresh, csrf });
    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
