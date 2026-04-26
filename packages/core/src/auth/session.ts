import { webcrypto } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import type { NxAuthUser } from "../config/types.js";
import { verifyToken, type NxTokenUse } from "./token.js";
import { nxSessions, nxUsers } from "../db/schema/system.js";

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
 * Verify a staff JWT and resolve the active user. The optional
 * `expectedUse` argument forces the token's `use` claim to match —
 * `getSessionUser` passes `"access"` so a refresh JWT cannot be
 * smuggled into the session cookie path (#94). Tokens missing the
 * `use` claim throw via `verifyToken`; we let that propagate so a
 * `NxAuthError` surfaces as 401 at the API layer.
 */
export async function verifyTokenFull(
  token: string,
  secret: string,
  db: any,
  expectedUse?: NxTokenUse,
): Promise<NxAuthUser | null> {
  const payload = await verifyToken(token, secret, expectedUse);
  const [user] = await db
    .select({
      id: nxUsers.id,
      email: nxUsers.email,
      name: nxUsers.name,
      role: nxUsers.role,
      tokenVersion: nxUsers.tokenVersion,
    })
    .from(nxUsers)
    .where(eq(nxUsers.id, payload.sub))
    .limit(1);

  if (!user || user.tokenVersion !== payload.ver) {
    return null;
  }

  return user;
}

export async function invalidateAllSessions(
  userId: string,
  db: any,
): Promise<void> {
  await db.transaction(async (tx: any) => {
    await tx
      .update(nxUsers)
      .set({
        tokenVersion: sql`${nxUsers.tokenVersion} + 1`,
      })
      .where(eq(nxUsers.id, userId));

    await tx.delete(nxSessions).where(eq(nxSessions.userId, userId));
  });
}
