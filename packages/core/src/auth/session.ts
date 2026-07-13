import { randomUUID, webcrypto } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  NpAuthContractError,
  npAnalyzeStaffSessionRecord,
  npAuthContractLimits,
  npRequireAuthUser,
  type NpAuthSessionTokens,
  type NpAuthUser,
} from "../auth-contract/index.js";
import { npSessions, npUsers } from "../db/schema/system.js";
import { signToken, verifyToken, type NpTokenUse } from "./token.js";

type SessionDb = NodePgDatabase<Record<string, unknown>>;

export interface NpStaffSessionOptions {
  accessExpiration: number;
  refreshExpiration: number;
  userAgent?: string | null;
  ip?: string | null;
}

export interface NpRotatedStaffSession extends NpAuthSessionTokens {
  user: NpAuthUser;
}

export async function sha256(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireExpiration(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer number of seconds.`);
  }
}

function normalizeMetadata(options: NpStaffSessionOptions): {
  userAgent: string | null;
  ip: string | null;
} {
  return {
    userAgent:
      typeof options.userAgent === "string"
        ? options.userAgent.slice(0, npAuthContractLimits.userAgentLength)
        : null,
    ip: typeof options.ip === "string" ? options.ip.slice(0, npAuthContractLimits.ipLength) : null,
  };
}

function requireSessionRecord(value: unknown): void {
  const issues = npAnalyzeStaffSessionRecord(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid staff session row", issues);
}

function toAuthUser(row: unknown): NpAuthUser {
  return npRequireAuthUser(row, "staffUser");
}

export async function createStaffSession(
  userInput: NpAuthUser,
  secret: string,
  db: SessionDb,
  options: NpStaffSessionOptions,
): Promise<NpAuthSessionTokens> {
  requireExpiration(options.accessExpiration, "accessExpiration");
  requireExpiration(options.refreshExpiration, "refreshExpiration");
  if (options.refreshExpiration < options.accessExpiration) {
    throw new Error("refreshExpiration must not be shorter than accessExpiration.");
  }
  const user = toAuthUser(userInput);
  const sessionId = randomUUID();
  const now = new Date();
  const access = await signToken(user, secret, options.accessExpiration, "access", sessionId);
  const refresh = await signToken(user, secret, options.refreshExpiration, "refresh", sessionId);
  const [accessTokenHash, refreshTokenHash] = await Promise.all([sha256(access), sha256(refresh)]);
  const [row] = await db
    .insert(npSessions)
    .values({
      id: sessionId,
      userId: user.id,
      accessTokenHash,
      refreshTokenHash,
      accessExpiresAt: new Date(now.valueOf() + options.accessExpiration * 1000),
      refreshExpiresAt: new Date(now.valueOf() + options.refreshExpiration * 1000),
      ...normalizeMetadata(options),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  requireSessionRecord(row);
  return { sessionId, access, refresh };
}

/**
 * Verify a staff JWT, require its exact claims, require the matching live
 * database session pair, and resolve the current persisted user projection.
 */
export async function verifyTokenFull(
  token: string,
  secret: string,
  db: SessionDb,
  expectedUse: NpTokenUse = "access",
): Promise<NpAuthUser | null> {
  const payload = await verifyToken(token, secret, expectedUse);
  const tokenHash = await sha256(token);
  const now = new Date();
  const sessionCondition =
    expectedUse === "access"
      ? and(
          eq(npSessions.id, payload.sid),
          eq(npSessions.userId, payload.sub),
          eq(npSessions.accessTokenHash, tokenHash),
          gt(npSessions.accessExpiresAt, now),
        )
      : and(
          eq(npSessions.id, payload.sid),
          eq(npSessions.userId, payload.sub),
          eq(npSessions.refreshTokenHash, tokenHash),
          gt(npSessions.refreshExpiresAt, now),
        );
  const [[session], [userRow]] = await Promise.all([
    db.select().from(npSessions).where(sessionCondition).limit(1),
    db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
      })
      .from(npUsers)
      .where(eq(npUsers.id, payload.sub))
      .limit(1),
  ]);
  if (!session || !userRow) return null;
  requireSessionRecord(session);
  const user = toAuthUser(userRow);
  return user.tokenVersion === payload.ver ? user : null;
}

export async function rotateStaffSession(
  refreshToken: string,
  secret: string,
  db: SessionDb,
  options: NpStaffSessionOptions,
): Promise<NpRotatedStaffSession | null> {
  requireExpiration(options.accessExpiration, "accessExpiration");
  requireExpiration(options.refreshExpiration, "refreshExpiration");
  if (options.refreshExpiration < options.accessExpiration) {
    throw new Error("refreshExpiration must not be shorter than accessExpiration.");
  }
  const payload = await verifyToken(refreshToken, secret, "refresh");
  const oldRefreshHash = await sha256(refreshToken);
  const [userRow] = await db
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
  if (!userRow) return null;
  const user = toAuthUser(userRow);
  if (user.tokenVersion !== payload.ver) return null;

  const access = await signToken(user, secret, options.accessExpiration, "access", payload.sid);
  const refresh = await signToken(user, secret, options.refreshExpiration, "refresh", payload.sid);
  const [accessTokenHash, refreshTokenHash] = await Promise.all([sha256(access), sha256(refresh)]);
  const now = new Date();
  const [updated] = await db
    .update(npSessions)
    .set({
      accessTokenHash,
      refreshTokenHash,
      accessExpiresAt: new Date(now.valueOf() + options.accessExpiration * 1000),
      refreshExpiresAt: new Date(now.valueOf() + options.refreshExpiration * 1000),
      ...normalizeMetadata(options),
      updatedAt: now,
    })
    .where(
      and(
        eq(npSessions.id, payload.sid),
        eq(npSessions.userId, payload.sub),
        eq(npSessions.refreshTokenHash, oldRefreshHash),
        gt(npSessions.refreshExpiresAt, now),
      ),
    )
    .returning();
  if (!updated) return null;
  requireSessionRecord(updated);
  return { user, sessionId: payload.sid, access, refresh };
}

/** Delete one browser session using either live token and their shared `sid`. */
export async function revokeStaffSession(
  token: string,
  secret: string,
  db: SessionDb,
  expectedUse: NpTokenUse = "access",
): Promise<NpAuthUser | null> {
  const payload = await verifyToken(token, secret, expectedUse);
  const tokenHash = await sha256(token);
  const tokenCondition =
    expectedUse === "access"
      ? eq(npSessions.accessTokenHash, tokenHash)
      : eq(npSessions.refreshTokenHash, tokenHash);
  const [deleted] = await db
    .delete(npSessions)
    .where(and(eq(npSessions.id, payload.sid), eq(npSessions.userId, payload.sub), tokenCondition))
    .returning({ userId: npSessions.userId });
  if (!deleted) return null;
  const [userRow] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, deleted.userId))
    .limit(1);
  return userRow ? toAuthUser(userRow) : null;
}

export async function invalidateAllSessions(userId: string, db: SessionDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(npUsers)
      .set({ tokenVersion: sql`${npUsers.tokenVersion} + 1` })
      .where(eq(npUsers.id, userId));
    await tx.delete(npSessions).where(eq(npSessions.userId, userId));
  });
}

/** Atomically replace a staff password and revoke every existing session. */
export async function replaceStaffPasswordAndInvalidateSessions(
  userId: string,
  expectedPasswordHash: string,
  passwordHash: string,
  db: SessionDb,
): Promise<boolean> {
  if (expectedPasswordHash.length === 0 || passwordHash.length === 0) {
    throw new Error("Password hashes must not be empty.");
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(npUsers)
      .set({
        password: passwordHash,
        tokenVersion: sql`${npUsers.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(npUsers.id, userId), eq(npUsers.password, expectedPasswordHash)))
      .returning({ id: npUsers.id });
    if (!updated) return false;
    await tx.delete(npSessions).where(eq(npSessions.userId, userId));
    return true;
  });
}
