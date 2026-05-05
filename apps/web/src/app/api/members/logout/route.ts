import { npMemberSessions, sha256 } from "@nexpress/core";
import { inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { clearMemberAuthCookies } from "@/lib/member-auth-helpers";
import { ensureFor } from "@/lib/init-core";

export async function POST(request: NextRequest) {
  await ensureFor("read");
  const sessionToken = request.cookies.get("np-mb-session")?.value;
  const refreshToken = request.cookies.get("np-mb-refresh")?.value;

  // Revoke BOTH session rows (access + refresh) so a stolen refresh
  // JWT can't mint new access tokens after the user logged out (#45).
  // The previous version only deleted the access-token row.
  // Best-effort — clearing the cookies below is enough to log the
  // user out of this device even if the delete misses.
  const hashes: string[] = [];
  if (sessionToken) hashes.push(await sha256(sessionToken));
  if (refreshToken) hashes.push(await sha256(refreshToken));
  if (hashes.length > 0) {
    try {
      const db = getDb();
      await db
        .delete(npMemberSessions)
        .where(inArray(npMemberSessions.tokenHash, hashes));
    } catch {
      // Swallow — caller still gets cookies cleared below.
    }
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearMemberAuthCookies(response);
  return response;
}
