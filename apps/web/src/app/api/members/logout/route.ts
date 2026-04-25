import { nxMemberSessions, sha256 } from "@nexpress/core";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { clearMemberAuthCookies } from "@/lib/member-auth-helpers";
import { ensureCoreServices } from "@/lib/init-core";

export async function POST(request: NextRequest) {
  ensureCoreServices();
  const sessionToken = request.cookies.get("nx-mb-session")?.value;

  // Revoke the matching session row so a stolen access token can't
  // be reused even before its JWT expiry. Best-effort — even when the
  // delete misses, clearing cookies is enough to log the user out.
  if (sessionToken) {
    try {
      const tokenHash = await sha256(sessionToken);
      const db = getDb();
      // We don't have the member id from the cookie alone; scope the
      // delete to the token hash, which uniquely identifies the row.
      await db.delete(nxMemberSessions).where(
        and(
          eq(nxMemberSessions.tokenHash, tokenHash),
        ),
      );
    } catch {
      // Swallow — caller still gets cookies cleared below.
    }
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearMemberAuthCookies(response);
  return response;
}
