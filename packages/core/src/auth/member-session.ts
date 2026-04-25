import { eq, sql } from "drizzle-orm";
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

export async function getMemberFromTokenPayload(
  db: NodePgDatabase<Record<string, unknown>>,
  payload: { sub: string; ver: number },
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
