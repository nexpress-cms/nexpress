import { randomUUID } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  NpAuthContractError,
  npAnalyzeMemberAuthUser,
  npAnalyzeMemberSessionRecord,
  npAuthContractLimits,
  npIsCanonicalAuthId,
  type NpAuthSessionTokens,
  type NpMemberAuthUser,
  type NpMemberTokenPayload,
} from "../auth-contract/index.js";
import { npMemberSessions, npMembers } from "../db/schema/community.js";
import { sha256 } from "./session.js";
import { signMemberToken, verifyMemberToken, type NpMemberTokenUse } from "./member-token.js";

type MemberSessionDb = NodePgDatabase<Record<string, unknown>>;

export type NpMemberAuthRow = NpMemberAuthUser;

export interface NpMemberSessionOptions {
  accessExpiration: number;
  refreshExpiration: number;
  userAgent?: string | null;
  ip?: string | null;
}

export interface NpRotatedMemberSession extends NpAuthSessionTokens {
  member: NpMemberAuthUser;
}

export interface NpMemberPasswordProfilePatch {
  displayName?: string;
  bio?: string | null;
  avatar?: string | null;
}

function requireExpiration(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer number of seconds.`);
  }
}

function normalizeMetadata(options: NpMemberSessionOptions): {
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

function requireMember(value: unknown): NpMemberAuthUser {
  const issues = npAnalyzeMemberAuthUser(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid member auth row", issues);
  return value as NpMemberAuthUser;
}

function requireSessionRecord(value: unknown): void {
  const issues = npAnalyzeMemberSessionRecord(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid member session row", issues);
}

function requirePasswordProfilePatch(patch: NpMemberPasswordProfilePatch): void {
  const unknownField = Object.keys(patch).find(
    (key) => !["displayName", "bio", "avatar"].includes(key),
  );
  if (unknownField) throw new Error(`Unsupported member profile field: ${unknownField}`);
  if (
    patch.displayName !== undefined &&
    (patch.displayName.length === 0 ||
      patch.displayName !== patch.displayName.trim() ||
      patch.displayName.length > npAuthContractLimits.displayNameLength)
  ) {
    throw new Error("displayName must be a non-empty trimmed member display name.");
  }
  if (
    patch.bio !== undefined &&
    patch.bio !== null &&
    (typeof patch.bio !== "string" || patch.bio.length > npAuthContractLimits.bioLength)
  ) {
    throw new Error("bio must be null or a bounded string.");
  }
  if (patch.avatar !== undefined && patch.avatar !== null && !npIsCanonicalAuthId(patch.avatar)) {
    throw new Error("avatar must be a UUID or null.");
  }
}

async function readMember(db: MemberSessionDb, memberId: string): Promise<NpMemberAuthUser | null> {
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
    .where(eq(npMembers.id, memberId))
    .limit(1);
  return row ? requireMember(row) : null;
}

export async function createMemberSession(
  memberInput: NpMemberAuthUser,
  secret: string,
  db: MemberSessionDb,
  options: NpMemberSessionOptions,
): Promise<NpAuthSessionTokens> {
  requireExpiration(options.accessExpiration, "accessExpiration");
  requireExpiration(options.refreshExpiration, "refreshExpiration");
  if (options.refreshExpiration < options.accessExpiration) {
    throw new Error("refreshExpiration must not be shorter than accessExpiration.");
  }
  const member = requireMember(memberInput);
  if (member.status !== "active") {
    throw new NpAuthContractError("Cannot create an inactive member session", [
      {
        code: "invariant",
        path: "member.status",
        message: 'must be "active" when a session is created.',
      },
    ]);
  }
  const sessionId = randomUUID();
  const now = new Date();
  const access = await signMemberToken(
    member,
    secret,
    options.accessExpiration,
    "access",
    sessionId,
  );
  const refresh = await signMemberToken(
    member,
    secret,
    options.refreshExpiration,
    "refresh",
    sessionId,
  );
  const [accessTokenHash, refreshTokenHash] = await Promise.all([sha256(access), sha256(refresh)]);
  const [row] = await db
    .insert(npMemberSessions)
    .values({
      id: sessionId,
      memberId: member.id,
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

export async function getMemberFromTokenPayload(
  db: MemberSessionDb,
  payload: NpMemberTokenPayload,
  accessToken: string,
): Promise<NpMemberAuthUser | null> {
  if (payload.use !== "access") return null;
  const accessTokenHash = await sha256(accessToken);
  const now = new Date();
  const [[session], member] = await Promise.all([
    db
      .select()
      .from(npMemberSessions)
      .where(
        and(
          eq(npMemberSessions.id, payload.sid),
          eq(npMemberSessions.memberId, payload.sub),
          eq(npMemberSessions.accessTokenHash, accessTokenHash),
          gt(npMemberSessions.accessExpiresAt, now),
        ),
      )
      .limit(1),
    readMember(db, payload.sub),
  ]);
  if (!session || !member || member.status !== "active" || member.tokenVersion !== payload.ver) {
    return null;
  }
  requireSessionRecord(session);
  return member;
}

export async function rotateMemberSession(
  refreshToken: string,
  secret: string,
  db: MemberSessionDb,
  options: NpMemberSessionOptions,
): Promise<NpRotatedMemberSession | null> {
  requireExpiration(options.accessExpiration, "accessExpiration");
  requireExpiration(options.refreshExpiration, "refreshExpiration");
  if (options.refreshExpiration < options.accessExpiration) {
    throw new Error("refreshExpiration must not be shorter than accessExpiration.");
  }
  const payload = await verifyMemberToken(refreshToken, secret, "refresh");
  const member = await readMember(db, payload.sub);
  if (!member || member.status !== "active" || member.tokenVersion !== payload.ver) return null;

  const oldRefreshHash = await sha256(refreshToken);
  const access = await signMemberToken(
    member,
    secret,
    options.accessExpiration,
    "access",
    payload.sid,
  );
  const refresh = await signMemberToken(
    member,
    secret,
    options.refreshExpiration,
    "refresh",
    payload.sid,
  );
  const [accessTokenHash, refreshTokenHash] = await Promise.all([sha256(access), sha256(refresh)]);
  const now = new Date();
  const [updated] = await db
    .update(npMemberSessions)
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
        eq(npMemberSessions.id, payload.sid),
        eq(npMemberSessions.memberId, payload.sub),
        eq(npMemberSessions.refreshTokenHash, oldRefreshHash),
        gt(npMemberSessions.refreshExpiresAt, now),
      ),
    )
    .returning();
  if (!updated) return null;
  requireSessionRecord(updated);
  return { member, sessionId: payload.sid, access, refresh };
}

export async function revokeMemberSession(
  token: string,
  secret: string,
  db: MemberSessionDb,
  expectedUse: NpMemberTokenUse = "access",
): Promise<NpMemberAuthUser | null> {
  const payload = await verifyMemberToken(token, secret, expectedUse);
  const tokenHash = await sha256(token);
  const tokenCondition =
    expectedUse === "access"
      ? eq(npMemberSessions.accessTokenHash, tokenHash)
      : eq(npMemberSessions.refreshTokenHash, tokenHash);
  const [deleted] = await db
    .delete(npMemberSessions)
    .where(
      and(
        eq(npMemberSessions.id, payload.sid),
        eq(npMemberSessions.memberId, payload.sub),
        tokenCondition,
      ),
    )
    .returning({ memberId: npMemberSessions.memberId });
  return deleted ? readMember(db, deleted.memberId) : null;
}

export async function invalidateAllMemberSessions(
  db: MemberSessionDb,
  memberId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(npMembers)
      .set({ tokenVersion: sql`${npMembers.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(npMembers.id, memberId));
    await tx.delete(npMemberSessions).where(eq(npMemberSessions.memberId, memberId));
  });
}

/** Atomically replace an active member password and revoke every session. */
export async function replaceMemberPasswordAndInvalidateSessions(
  db: MemberSessionDb,
  memberId: string,
  expectedPasswordHash: string,
  passwordHash: string,
  profilePatch: NpMemberPasswordProfilePatch = {},
): Promise<boolean> {
  if (expectedPasswordHash.length === 0 || passwordHash.length === 0) {
    throw new Error("Password hashes must not be empty.");
  }
  requirePasswordProfilePatch(profilePatch);
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(npMembers)
      .set({
        password: passwordHash,
        ...profilePatch,
        tokenVersion: sql`${npMembers.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(npMembers.id, memberId),
          eq(npMembers.status, "active"),
          eq(npMembers.password, expectedPasswordHash),
        ),
      )
      .returning({ id: npMembers.id });
    if (!updated) return false;
    await tx.delete(npMemberSessions).where(eq(npMemberSessions.memberId, memberId));
    return true;
  });
}
