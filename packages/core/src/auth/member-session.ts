import { and, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { nxMemberSessions, nxMembers } from "../db/schema/community.js";
import { sha256 } from "./session.js";

/**
 * Member-side session lookups, mirroring the staff helpers in session.ts
 * but for `nx_members` / `nx_member_sessions`. The sha256 helper is
 * reused (sessions store hashed tokens regardless of the principal kind).
 */

export interface NxMemberAuthRow {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  status: "active" | "pending" | "suspended" | "deleted";
  tokenVersion: number;
}

/**
 * Resolve a member from a verified JWT payload AND the raw access
 * token. We hash the token and require a live row in
 * `nx_member_sessions` — without that row check, deleting a session in
 * `/api/members/logout` had no effect and a stolen token kept working
 * until JWT expiry. (#45)
 *
 * Backward-compat: when no `accessToken` is passed (legacy callers in
 * tests / older routes), we fall back to the previous tokenVersion
 * check only. New paths should always pass the token.
 */
export async function getMemberFromTokenPayload(
  db: NodePgDatabase<Record<string, unknown>>,
  payload: { sub: string; ver: number },
  accessToken?: string,
): Promise<NxMemberAuthRow | null> {
  const [row] = await db
    .select({
      id: nxMembers.id,
      email: nxMembers.email,
      handle: nxMembers.handle,
      displayName: nxMembers.displayName,
      status: nxMembers.status,
      tokenVersion: nxMembers.tokenVersion,
    })
    .from(nxMembers)
    .where(eq(nxMembers.id, payload.sub))
    .limit(1);

  if (!row) return null;
  if (row.tokenVersion !== payload.ver) return null;

  if (accessToken) {
    const tokenHash = await sha256(accessToken);
    const now = new Date();
    const [session] = (await db
      .select({ id: nxMemberSessions.id })
      .from(nxMemberSessions)
      .where(
        and(
          eq(nxMemberSessions.memberId, row.id),
          eq(nxMemberSessions.tokenHash, tokenHash),
          gt(nxMemberSessions.expiresAt, now),
        ),
      )
      .limit(1)) as Array<{ id: string }>;
    if (!session) return null;
  }

  return row as NxMemberAuthRow;
}

/**
 * Bumps a member's tokenVersion + drops every session row, force-logging
 * them out everywhere. Call inside the same transaction as a password
 * change / soft-delete so a leaked old JWT can't outlive the change.
 */
export async function invalidateAllMemberSessions(
  db: NodePgDatabase<Record<string, unknown>>,
  memberId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(nxMembers)
      .set({
        tokenVersion: sql`${nxMembers.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(nxMembers.id, memberId));
    await tx.delete(nxMemberSessions).where(eq(nxMemberSessions.memberId, memberId));
  });
}
