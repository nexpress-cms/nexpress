import { randomBytes } from "node:crypto";

import {
  NpAuthError,
  getMemberFromTokenPayload,
  npMemberSessions,
  sha256,
  signMemberToken,
  verifyMemberToken,
} from "@nexpress/core";
import { and, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { npErrorResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { getMemberAuthRuntimeConfig, setMemberAuthCookies } from "@/lib/member-auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Member refresh-token rotation. Validates the refresh JWT signature,
 * confirms a matching live session row exists in `np_member_sessions`,
 * then rotates: deletes the consumed refresh row, mints a new access +
 * refresh pair, and persists both as new session rows.
 *
 * Without the session-row check, logout couldn't actually revoke
 * refresh tokens — a leaked refresh JWT minted new access tokens
 * until JWT expiry. (#45 reopened follow-up.)
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("read");
    const refreshToken = request.cookies.get("np-mb-refresh")?.value;
    if (!refreshToken) throw new NpAuthError();

    const { secret, tokenExpiration, refreshTokenExpiration } = getMemberAuthRuntimeConfig();
    // Reject access tokens presented as refresh triggers — without the
    // `use` check a stolen access JWT could spin a fresh access +
    // refresh pair (#91).
    const payload = await verifyMemberToken(refreshToken, secret, "refresh");
    const member = await getMemberFromTokenPayload(getDb() as never, payload);
    if (!member || member.status !== "active") throw new NpAuthError();

    const db = getDb();
    const refreshHash = await sha256(refreshToken);
    const now = new Date();

    // Confirm a live session row exists for this refresh token. If
    // logout deleted it (or it never existed), refuse — the JWT
    // signature alone is no longer enough.
    const [sessionRow] = await db
      .select({ id: npMemberSessions.id })
      .from(npMemberSessions)
      .where(
        and(
          eq(npMemberSessions.memberId, member.id),
          eq(npMemberSessions.tokenHash, refreshHash),
          gt(npMemberSessions.expiresAt, now),
        ),
      )
      .limit(1);
    if (!sessionRow) throw new NpAuthError();

    const access = await signMemberToken(member, secret, tokenExpiration, "access");
    const refresh = await signMemberToken(member, secret, refreshTokenExpiration, "refresh");
    const csrf = randomBytes(16).toString("hex");

    // Rotate: drop the consumed refresh row + insert fresh access +
    // refresh rows. Transaction keeps the user always authenticable —
    // there's no window where they have neither old nor new tokens.
    const userAgent = request.headers.get("user-agent") ?? null;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await db.transaction(async (tx) => {
      await tx.delete(npMemberSessions).where(eq(npMemberSessions.id, sessionRow.id));
      await tx.insert(npMemberSessions).values([
        {
          memberId: member.id,
          tokenHash: await sha256(access),
          userAgent,
          ip,
          expiresAt: new Date(Date.now() + tokenExpiration * 1000),
        },
        {
          memberId: member.id,
          tokenHash: await sha256(refresh),
          userAgent,
          ip,
          expiresAt: new Date(Date.now() + refreshTokenExpiration * 1000),
        },
      ]);
    });

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
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
