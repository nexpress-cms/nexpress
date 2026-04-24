import { randomBytes } from "node:crypto";

import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NxValidationError } from "../errors.js";
import { nxSessions, nxUsers } from "../db/schema/system.js";
import { hashPassword } from "./password.js";
import { sha256 } from "./session.js";

export type NxPasswordResetPurpose = "invite" | "reset";

export interface NxIssuedResetToken {
  /** The raw token — deliver to the user, never persist. */
  token: string;
  /** Matches `nx_users.password_reset_expires_at`. */
  expiresAt: Date;
  purpose: NxPasswordResetPurpose;
}

export interface NxCreateResetTokenOptions {
  userId: string;
  purpose: NxPasswordResetPurpose;
  ttlMs: number;
}

const MIN_PASSWORD_LENGTH = 8;

function generateRawToken(): string {
  // 32 bytes → 64 hex chars. Wide enough that brute force is hopeless.
  return randomBytes(32).toString("hex");
}

/**
 * Issues a new password reset token for `userId`. Stores the **hash** of the
 * token in the `nx_users` row alongside the expiry and purpose, then returns
 * the raw token for the caller to deliver (email/link).
 *
 * Any previously-outstanding reset token for the user is replaced.
 */
export async function createPasswordResetToken(
  db: NodePgDatabase<Record<string, unknown>>,
  options: NxCreateResetTokenOptions,
): Promise<NxIssuedResetToken> {
  const token = generateRawToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + options.ttlMs);

  await db
    .update(nxUsers)
    .set({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
      passwordResetPurpose: options.purpose,
      updatedAt: new Date(),
    })
    .where(eq(nxUsers.id, options.userId));

  return { token, expiresAt, purpose: options.purpose };
}

export interface NxResetRequestResult {
  userId: string | null;
  name: string | null;
  email: string | null;
  issued: NxIssuedResetToken | null;
}

/**
 * Handles the "forgot password" flow. If the email matches a user, issues a
 * reset token and returns their name so the mailer can personalise the email.
 * If not, silently returns nulls so callers can respond with a constant
 * message and avoid email enumeration.
 */
export async function requestPasswordReset(
  db: NodePgDatabase<Record<string, unknown>>,
  email: string,
  ttlMs: number,
): Promise<NxResetRequestResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db
    .select({
      id: nxUsers.id,
      email: nxUsers.email,
      name: nxUsers.name,
    })
    .from(nxUsers)
    .where(eq(nxUsers.email, normalizedEmail))
    .limit(1);

  if (!user) {
    return { userId: null, name: null, email: null, issued: null };
  }

  const issued = await createPasswordResetToken(db, {
    userId: user.id,
    purpose: "reset",
    ttlMs,
  });

  return { userId: user.id, name: user.name, email: user.email, issued };
}

export interface NxConsumeResetTokenOptions {
  token: string;
  newPassword: string;
}

export interface NxConsumeResetTokenResult {
  userId: string;
  email: string;
  purpose: NxPasswordResetPurpose;
}

/**
 * Verifies a password reset token and atomically:
 * - sets the new password hash
 * - bumps `tokenVersion` and deletes all sessions (force logout everywhere)
 * - clears the reset columns on the user row
 *
 * Throws `NxValidationError` when the token is unknown, expired, or the
 * password is too short. Uses a single DB transaction for atomicity.
 */
export async function consumePasswordResetToken(
  db: NodePgDatabase<Record<string, unknown>>,
  options: NxConsumeResetTokenOptions,
): Promise<NxConsumeResetTokenResult> {
  if (!options.token || typeof options.token !== "string") {
    throw new NxValidationError("Invalid input", [
      { field: "token", message: "Reset token is required." },
    ]);
  }

  if (!options.newPassword || options.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new NxValidationError("Invalid input", [
      {
        field: "password",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
    ]);
  }

  const tokenHash = await sha256(options.token);
  const now = new Date();

  const [user] = await db
    .select({
      id: nxUsers.id,
      email: nxUsers.email,
      purpose: nxUsers.passwordResetPurpose,
    })
    .from(nxUsers)
    .where(
      and(
        eq(nxUsers.passwordResetTokenHash, tokenHash),
        isNotNull(nxUsers.passwordResetExpiresAt),
        gt(nxUsers.passwordResetExpiresAt, now),
      ),
    )
    .limit(1);

  if (!user) {
    throw new NxValidationError("Invalid input", [
      { field: "token", message: "Reset link is invalid or has expired." },
    ]);
  }

  const newPasswordHash = await hashPassword(options.newPassword);

  // We inline the tokenVersion bump + session delete instead of calling
  // invalidateAllSessions because we need them to land in the same
  // transaction as the password write + reset-column clear. Splitting into
  // two transactions could leave the user with a new password but still-
  // valid old JWTs if the second call failed.
  await db.transaction(async (tx) => {
    await tx
      .update(nxUsers)
      .set({
        password: newPasswordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetPurpose: null,
        loginAttempts: 0,
        lockUntil: null,
        tokenVersion: sql`${nxUsers.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(nxUsers.id, user.id));

    await tx.delete(nxSessions).where(eq(nxSessions.userId, user.id));
  });

  return {
    userId: user.id,
    email: user.email,
    purpose: (user.purpose ?? "reset") as NxPasswordResetPurpose,
  };
}
