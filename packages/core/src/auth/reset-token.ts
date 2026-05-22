import { randomBytes } from "node:crypto";

import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NpValidationError } from "../errors.js";
import { npSessions, npUsers } from "../db/schema/system.js";
import { hashPassword } from "./password.js";
import { sha256 } from "./session.js";

export type NpPasswordResetPurpose = "invite" | "reset";

export interface NpIssuedResetToken {
  /** The raw token — deliver to the user, never persist. */
  token: string;
  /** Matches `np_users.password_reset_expires_at`. */
  expiresAt: Date;
  purpose: NpPasswordResetPurpose;
}

export interface NpCreateResetTokenOptions {
  userId: string;
  purpose: NpPasswordResetPurpose;
  ttlMs: number;
}

const MIN_PASSWORD_LENGTH = 8;

function generateRawToken(): string {
  // 32 bytes → 64 hex chars. Wide enough that brute force is hopeless.
  return randomBytes(32).toString("hex");
}

/**
 * Issues a new password reset token for `userId`. Stores the **hash** of the
 * token in the `np_users` row alongside the expiry and purpose, then returns
 * the raw token for the caller to deliver (email/link).
 *
 * Any previously-outstanding reset token for the user is replaced.
 */
export async function createPasswordResetToken(
  db: NodePgDatabase<Record<string, unknown>>,
  options: NpCreateResetTokenOptions,
): Promise<NpIssuedResetToken> {
  const token = generateRawToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + options.ttlMs);

  await db
    .update(npUsers)
    .set({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
      passwordResetPurpose: options.purpose,
      updatedAt: new Date(),
    })
    .where(eq(npUsers.id, options.userId));

  return { token, expiresAt, purpose: options.purpose };
}

export interface NpResetRequestResult {
  userId: string | null;
  name: string | null;
  email: string | null;
  issued: NpIssuedResetToken | null;
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
): Promise<NpResetRequestResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
    })
    .from(npUsers)
    .where(eq(npUsers.email, normalizedEmail))
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

export interface NpConsumeResetTokenOptions {
  token: string;
  newPassword: string;
}

export interface NpConsumeResetTokenResult {
  userId: string;
  email: string;
  purpose: NpPasswordResetPurpose;
}

/**
 * Verifies a password reset token and atomically:
 * - sets the new password hash
 * - bumps `tokenVersion` and deletes all sessions (force logout everywhere)
 * - clears the reset columns on the user row
 *
 * Throws `NpValidationError` when the token is unknown, expired, or the
 * password is too short. Uses a single DB transaction for atomicity.
 */
export async function consumePasswordResetToken(
  db: NodePgDatabase<Record<string, unknown>>,
  options: NpConsumeResetTokenOptions,
): Promise<NpConsumeResetTokenResult> {
  if (!options.token || typeof options.token !== "string") {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Reset token is required." },
    ]);
  }

  if (!options.newPassword || options.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new NpValidationError("Invalid input", [
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
      id: npUsers.id,
      email: npUsers.email,
      purpose: npUsers.passwordResetPurpose,
    })
    .from(npUsers)
    .where(
      and(
        eq(npUsers.passwordResetTokenHash, tokenHash),
        isNotNull(npUsers.passwordResetExpiresAt),
        gt(npUsers.passwordResetExpiresAt, now),
      ),
    )
    .limit(1);

  if (!user) {
    throw new NpValidationError("Invalid input", [
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
      .update(npUsers)
      .set({
        password: newPasswordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetPurpose: null,
        loginAttempts: 0,
        lockUntil: null,
        tokenVersion: sql`${npUsers.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(npUsers.id, user.id));

    await tx.delete(npSessions).where(eq(npSessions.userId, user.id));
  });

  return {
    userId: user.id,
    email: user.email,
    purpose: (user.purpose ?? "reset"),
  };
}
