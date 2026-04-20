import { webcrypto } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import type { NxAuthUser } from "../config/types.js";
import { verifyToken } from "./token.js";
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

export async function verifyTokenFull(
  token: string,
  secret: string,
  db: any,
): Promise<NxAuthUser | null> {
  const payload = await verifyToken(token, secret);
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
