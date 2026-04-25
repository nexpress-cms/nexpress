import { randomBytes } from "node:crypto";

import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NxValidationError } from "../errors.js";
import { nxMemberSessions, nxMembers } from "../db/schema/community.js";
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

export interface NxIssuedMemberToken {
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
): Promise<NxIssuedMemberToken> {
  const token = generateRawToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .update(nxMembers)
    .set({
      emailVerifyTokenHash: tokenHash,
      emailVerifyExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(nxMembers.id, memberId));

  return { token, expiresAt };
}

export interface NxConsumeMemberEmailVerifyResult {
  memberId: string;
  email: string;
  handle: string;
  displayName: string;
}

export async function consumeMemberEmailVerifyToken(
  db: NodePgDatabase<Record<string, unknown>>,
  token: string,
): Promise<NxConsumeMemberEmailVerifyResult> {
  if (!token || typeof token !== "string") {
    throw new NxValidationError("Invalid input", [
      { field: "token", message: "Verification token is required." },
    ]);
  }
  const tokenHash = await sha256(token);
  const now = new Date();

  const [member] = await db
    .select({
      id: nxMembers.id,
      email: nxMembers.email,
      handle: nxMembers.handle,
      displayName: nxMembers.displayName,
    })
    .from(nxMembers)
    .where(
      and(
        eq(nxMembers.emailVerifyTokenHash, tokenHash),
        isNotNull(nxMembers.emailVerifyExpiresAt),
        gt(nxMembers.emailVerifyExpiresAt, now),
      ),
    )
    .limit(1);

  if (!member) {
    throw new NxValidationError("Invalid input", [
      { field: "token", message: "Verification link is invalid or has expired." },
    ]);
  }

  await db
    .update(nxMembers)
    .set({
      emailVerified: true,
      // Pending → active on first verify so login can succeed afterwards.
      // Suspended/deleted members stay where they are; the mod UI flips
      // those statuses, never the verify endpoint.
      status: sql`case when ${nxMembers.status} = 'pending' then 'active' else ${nxMembers.status} end`,
      emailVerifyTokenHash: null,
      emailVerifyExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(nxMembers.id, member.id));

  return {
    memberId: member.id,
    email: member.email,
    handle: member.handle,
    displayName: member.displayName,
  };
}

// ── Password reset ────────────────────────────────────────────────────

export interface NxMemberResetRequestResult {
  memberId: string | null;
  displayName: string | null;
  email: string | null;
  issued: NxIssuedMemberToken | null;
}

export async function requestMemberPasswordReset(
  db: NodePgDatabase<Record<string, unknown>>,
  email: string,
  ttlMs: number,
): Promise<NxMemberResetRequestResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const [member] = await db
    .select({
      id: nxMembers.id,
      email: nxMembers.email,
      displayName: nxMembers.displayName,
      status: nxMembers.status,
    })
    .from(nxMembers)
    .where(eq(nxMembers.email, normalizedEmail))
    .limit(1);

  if (!member || member.status === "deleted") {
    return { memberId: null, displayName: null, email: null, issued: null };
  }

  const token = generateRawToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .update(nxMembers)
    .set({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(nxMembers.id, member.id));

  return {
    memberId: member.id,
    displayName: member.displayName,
    email: member.email,
    issued: { token, expiresAt },
  };
}

export interface NxConsumeMemberResetResult {
  memberId: string;
  email: string;
}

export async function consumeMemberPasswordReset(
  db: NodePgDatabase<Record<string, unknown>>,
  token: string,
  newPassword: string,
): Promise<NxConsumeMemberResetResult> {
  if (!token || typeof token !== "string") {
    throw new NxValidationError("Invalid input", [
      { field: "token", message: "Reset token is required." },
    ]);
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new NxValidationError("Invalid input", [
      {
        field: "password",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
    ]);
  }

  const tokenHash = await sha256(token);
  const now = new Date();

  const [member] = await db
    .select({ id: nxMembers.id, email: nxMembers.email })
    .from(nxMembers)
    .where(
      and(
        eq(nxMembers.passwordResetTokenHash, tokenHash),
        isNotNull(nxMembers.passwordResetExpiresAt),
        gt(nxMembers.passwordResetExpiresAt, now),
      ),
    )
    .limit(1);

  if (!member) {
    throw new NxValidationError("Invalid input", [
      { field: "token", message: "Reset link is invalid or has expired." },
    ]);
  }

  const newPasswordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(nxMembers)
      .set({
        password: newPasswordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        loginAttempts: 0,
        lockUntil: null,
        // Bump tokenVersion in-place so existing JWTs are invalidated. Also
        // mark email as verified — completing a reset on an unverified
        // account is itself proof of email ownership.
        tokenVersion: sql`${nxMembers.tokenVersion} + 1`,
        emailVerified: true,
        status: sql`case when ${nxMembers.status} = 'pending' then 'active' else ${nxMembers.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(nxMembers.id, member.id));

    await tx.delete(nxMemberSessions).where(eq(nxMemberSessions.memberId, member.id));
  });

  return { memberId: member.id, email: member.email };
}
