import { randomBytes } from "node:crypto";

import {
  NxAuthError,
  NxValidationError,
  nxMembers,
  nxMemberSessions,
  signMemberToken,
  sha256,
  verifyPassword,
} from "@nexpress/core";
import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";
import { NextResponse } from "next/server";

import { nxErrorResponse } from "@/lib/api-response";
import { setMemberAuthCookies, getMemberAuthRuntimeConfig } from "@/lib/member-auth-helpers";
import { getDb } from "@/lib/db";
import { ensureWriteReady } from "@/lib/init-core";

interface LoginBody {
  email: string;
  password: string;
}

function validate(raw: unknown): LoginBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email.includes("@") || password.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "credentials", message: "Email and password required" },
    ]);
  }
  return { email, password };
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const { email, password } = validate(await readJsonBody(request));
    const db = getDb();

    const [member] = await db
      .select({
        id: nxMembers.id,
        email: nxMembers.email,
        handle: nxMembers.handle,
        displayName: nxMembers.displayName,
        password: nxMembers.password,
        status: nxMembers.status,
        tokenVersion: nxMembers.tokenVersion,
        loginAttempts: nxMembers.loginAttempts,
        lockUntil: nxMembers.lockUntil,
      })
      .from(nxMembers)
      .where(eq(nxMembers.email, email))
      .limit(1);

    // Generic auth error for missing-account / wrong-password / pending
    // / suspended / deleted — anti-enumeration. Real reasons are logged
    // server-side (see observability hook).
    if (!member || !member.password) throw new NxAuthError("Invalid credentials");

    if (member.lockUntil && member.lockUntil > new Date()) {
      throw new NxAuthError("Account is temporarily locked");
    }

    const ok = await verifyPassword(member.password, password);
    if (!ok) {
      // Bump login_attempts; lock for 15min after 5 failures (mirrors staff).
      await db
        .update(nxMembers)
        .set({
          loginAttempts: sql`${nxMembers.loginAttempts} + 1`,
          lockUntil: sql`case when ${nxMembers.loginAttempts} + 1 >= 5 then now() + interval '15 minutes' else ${nxMembers.lockUntil} end`,
          updatedAt: new Date(),
        })
        .where(eq(nxMembers.id, member.id));
      throw new NxAuthError("Invalid credentials");
    }

    if (member.status !== "active") {
      // Pending (email not verified yet) or suspended/deleted — surface
      // the same generic error so attackers can't enumerate state.
      throw new NxAuthError("Invalid credentials");
    }

    // Reset throttle on success.
    await db
      .update(nxMembers)
      .set({ loginAttempts: 0, lockUntil: null, updatedAt: new Date() })
      .where(eq(nxMembers.id, member.id));

    const { secret, tokenExpiration, refreshTokenExpiration } = getMemberAuthRuntimeConfig();
    const access = await signMemberToken(member, secret, tokenExpiration);
    const refresh = await signMemberToken(member, secret, refreshTokenExpiration);
    const csrf = randomBytes(16).toString("hex");

    // Persist a session row so logout can revoke server-side. Token hash
    // matches the staff session contract.
    await db.insert(nxMemberSessions).values({
      memberId: member.id,
      tokenHash: await sha256(access),
      userAgent: request.headers.get("user-agent") ?? null,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      expiresAt: new Date(Date.now() + tokenExpiration * 1000),
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
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
