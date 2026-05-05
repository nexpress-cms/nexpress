import { webcrypto } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { NpAuthUser } from "../config/types.js";
import { verifyToken, type NpTokenUse } from "./token.js";
import { npSessions, npUsers } from "../db/schema/system.js";

/**
 * Loose Drizzle handle type — every staff-auth caller passes
 * the same NodePgDatabase, but TS over-narrows when the
 * generated schema record is folded in. Using
 * `Record<string, unknown>` keeps the helper portable across
 * schema generations without surfacing as `any`.
 */
type SessionDb = NodePgDatabase<Record<string, unknown>>;

export async function sha256(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Verify a staff JWT and resolve the active user.
 *
 * `expectedUse` defaults to `"access"` because every caller of this
 * helper outside the rotation endpoint reads `nx-session` (server
 * components, route handlers, the bootstrap layout). Defaulting
 * means a fresh route or RSC page can't accidentally tolerate a
 * refresh JWT in the session cookie just by forgetting the
 * argument. The rotation route explicitly passes `"refresh"` for
 * its `nx-refresh` read.
 *
 * Tokens missing the `use` claim throw via `verifyToken`; we let
 * that propagate so a `NpAuthError` surfaces as 401 at the API
 * layer.
 */
export async function verifyTokenFull(
  token: string,
  secret: string,
  db: SessionDb,
  expectedUse: NpTokenUse = "access",
): Promise<NpAuthUser | null> {
  const payload = await verifyToken(token, secret, expectedUse);
  const [user] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, payload.sub))
    .limit(1);

  if (!user || user.tokenVersion !== payload.ver) {
    return null;
  }

  return user;
}

export async function invalidateAllSessions(
  userId: string,
  db: SessionDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(npUsers)
      .set({
        tokenVersion: sql`${npUsers.tokenVersion} + 1`,
      })
      .where(eq(npUsers.id, userId));

    await tx.delete(npSessions).where(eq(npSessions.userId, userId));
  });
}
