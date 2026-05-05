import { and, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { npMemberSessions, npMembers } from "../db/schema/community.js";
import { sha256 } from "./session.js";

/**
 * Member-side session lookups, mirroring the staff helpers in session.ts
 * but for `np_members` / `np_member_sessions`. The sha256 helper is
 * reused (sessions store hashed tokens regardless of the principal kind).
 */

export interface NpMemberAuthRow {
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
 * `np_member_sessions` — without that row check, deleting a session in
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
): Promise<NpMemberAuthRow | null> {
  const [row] = await db
    .select({
      id: npMembers.id,
      email: npMembers.email,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      status: npMembers.status,
      tokenVersion: npMembers.tokenVersion,
    })
    .from(npMembers)
    .where(eq(npMembers.id, payload.sub))
    .limit(1);

  if (!row) return null;
  if (row.tokenVersion !== payload.ver) return null;

  if (accessToken) {
    const tokenHash = await sha256(accessToken);
    const now = new Date();
    const [session] = (await db
      .select({ id: npMemberSessions.id })
      .from(npMemberSessions)
      .where(
        and(
          eq(npMemberSessions.memberId, row.id),
          eq(npMemberSessions.tokenHash, tokenHash),
          gt(npMemberSessions.expiresAt, now),
        ),
      )
      .limit(1)) as Array<{ id: string }>;
    if (!session) return null;
  }

  return row as NpMemberAuthRow;
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
      .update(npMembers)
      .set({
        tokenVersion: sql`${npMembers.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(npMembers.id, memberId));
    await tx.delete(npMemberSessions).where(eq(npMemberSessions.memberId, memberId));
  });
}
