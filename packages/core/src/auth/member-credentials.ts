import { randomBytes } from "node:crypto";

import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NpValidationError } from "../errors.js";
import { npMemberSessions, npMembers } from "../db/schema/community.js";
import { hashPassword } from "./password.js";
import { sha256 } from "./session.js";

/**
 * Member-side credential flows: email verification on registration,
 * password reset, password change. Mirrors the staff equivalents in
 * `reset-token.ts` but writes to `nx_members` and uses dedicated
 * verify columns (`email_verify_token_hash` / `email_verify_expires_at`)
 * so a verify and a reset can coexist on the same member row.
 */

const MIN_PASSWORD_LENGTH = 8;

export interface NpIssuedMemberToken {
  /** The raw token to ship to the user. Never persist. */
  token: string;
  expiresAt: Date;
}

function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

// ── Email verification ────────────────────────────────────────────────

export async function createMemberEmailVerifyToken(
  db: NodePgDatabase<Record<string, unknown>>,
  memberId: string,
  ttlMs: number,
): Promise<NpIssuedMemberToken> {
  const token = generateRawToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .update(npMembers)
    .set({
      emailVerifyTokenHash: tokenHash,
      emailVerifyExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(npMembers.id, memberId));

  return { token, expiresAt };
}

export interface NpConsumeMemberEmailVerifyResult {
  memberId: string;
  email: string;
  handle: string;
  displayName: string;
}

export async function consumeMemberEmailVerifyToken(
  db: NodePgDatabase<Record<string, unknown>>,
  token: string,
): Promise<NpConsumeMemberEmailVerifyResult> {
  if (!token || typeof token !== "string") {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Verification token is required." },
    ]);
  }
  const tokenHash = await sha256(token);
  const now = new Date();

  const [member] = await db
    .select({
      id: npMembers.id,
      email: npMembers.email,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
    })
    .from(npMembers)
    .where(
      and(
        eq(npMembers.emailVerifyTokenHash, tokenHash),
        isNotNull(npMembers.emailVerifyExpiresAt),
        gt(npMembers.emailVerifyExpiresAt, now),
      ),
    )
    .limit(1);

  if (!member) {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Verification link is invalid or has expired." },
    ]);
  }

  await db
    .update(npMembers)
    .set({
      emailVerified: true,
      // Pending → active on first verify so login can succeed afterwards.
      // Suspended/deleted members stay where they are; the mod UI flips
      // those statuses, never the verify endpoint.
      status: sql`case when ${npMembers.status} = 'pending' then 'active' else ${npMembers.status} end`,
      emailVerifyTokenHash: null,
      emailVerifyExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(npMembers.id, member.id));

  return {
    memberId: member.id,
    email: member.email,
    handle: member.handle,
    displayName: member.displayName,
  };
}

// ── Password reset ────────────────────────────────────────────────────

export interface NpMemberResetRequestResult {
  memberId: string | null;
  displayName: string | null;
  email: string | null;
  issued: NpIssuedMemberToken | null;
}

export async function requestMemberPasswordReset(
  db: NodePgDatabase<Record<string, unknown>>,
  email: string,
  ttlMs: number,
): Promise<NpMemberResetRequestResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const [member] = await db
    .select({
      id: npMembers.id,
      email: npMembers.email,
      displayName: npMembers.displayName,
      status: npMembers.status,
    })
    .from(npMembers)
    .where(eq(npMembers.email, normalizedEmail))
    .limit(1);

  if (!member || member.status === "deleted") {
    return { memberId: null, displayName: null, email: null, issued: null };
  }

  const token = generateRawToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .update(npMembers)
    .set({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(npMembers.id, member.id));

  return {
    memberId: member.id,
    displayName: member.displayName,
    email: member.email,
    issued: { token, expiresAt },
  };
}

export interface NpConsumeMemberResetResult {
  memberId: string;
  email: string;
}

export async function consumeMemberPasswordReset(
  db: NodePgDatabase<Record<string, unknown>>,
  token: string,
  newPassword: string,
): Promise<NpConsumeMemberResetResult> {
  if (!token || typeof token !== "string") {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Reset token is required." },
    ]);
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new NpValidationError("Invalid input", [
      {
        field: "password",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
    ]);
  }

  const tokenHash = await sha256(token);
  const now = new Date();

  const [member] = await db
    .select({ id: npMembers.id, email: npMembers.email })
    .from(npMembers)
    .where(
      and(
        eq(npMembers.passwordResetTokenHash, tokenHash),
        isNotNull(npMembers.passwordResetExpiresAt),
        gt(npMembers.passwordResetExpiresAt, now),
      ),
    )
    .limit(1);

  if (!member) {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Reset link is invalid or has expired." },
    ]);
  }

  const newPasswordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(npMembers)
      .set({
        password: newPasswordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        loginAttempts: 0,
        lockUntil: null,
        // Bump tokenVersion in-place so existing JWTs are invalidated. Also
        // mark email as verified — completing a reset on an unverified
        // account is itself proof of email ownership.
        tokenVersion: sql`${npMembers.tokenVersion} + 1`,
        emailVerified: true,
        status: sql`case when ${npMembers.status} = 'pending' then 'active' else ${npMembers.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(npMembers.id, member.id));

    await tx.delete(npMemberSessions).where(eq(npMemberSessions.memberId, member.id));
  });

  return { memberId: member.id, email: member.email };
}
