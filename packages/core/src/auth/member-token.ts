import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

import { NpAuthError } from "../errors.js";

/**
 * Member-side JWT helpers. Mirrors `signToken` / `verifyToken` for
 * staff but adds a fixed `aud: "member"` claim so a forged JWT signed
 * for a staff user can't be replayed against member-only routes (and
 * vice-versa).
 *
 * The signing secret is the same `NX_SECRET`; rotating it invalidates
 * both staff and member sessions, which is the desired behavior.
 *
 * Every token gets a random `jti` so two tokens minted within the
 * same second for the same member produce DIFFERENT JWT strings —
 * needed for refresh-token rotation: without it, the rotated token
 * hash would collide with the prior token hash and revocation by
 * tokenHash would still resolve the rotated row.
 *
 * `use: "access" | "refresh"` separates the two token purposes. A
 * refresh JWT cannot be presented as the `nx-mb-session` cookie and
 * a session JWT cannot drive the rotation endpoint — without this
 * separation a leaked refresh token effectively became a long-lived
 * bearer access token because both kinds were stored as fungible
 * rows in `nx_member_sessions` with no row-level kind column.
 */
export type NpMemberTokenUse = "access" | "refresh";

export interface NpMemberTokenPayload {
  sub: string;
  aud: "member";
  ver: number;
  /** Required. `verifyMemberToken` refuses tokens missing this claim
   *  so legacy refresh JWTs from before #92 cannot be smuggled into
   *  the session cookie path (#91 reopen). */
  use: NpMemberTokenUse;
  /** Optional only for the deploy window; new tokens always carry
   *  one. */
  jti?: string;
  iat: number;
  exp: number;
}

const textEncoder = new TextEncoder();
const MEMBER_AUDIENCE = "member";

export async function signMemberToken(
  member: { id: string; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
  tokenUse: NpMemberTokenUse = "access",
): Promise<string> {
  const secretKey = textEncoder.encode(secret);
  return new SignJWT({ sub: member.id, ver: member.tokenVersion, use: tokenUse })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(MEMBER_AUDIENCE)
    .setJti(randomBytes(16).toString("base64url"))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expirationSeconds)
    .sign(secretKey);
}

/**
 * Verify a member JWT and return the parsed payload. When
 * `expectedUse` is provided, refuses tokens whose `use` claim doesn't
 * match — that's how `getSessionMember` rejects a refresh token used
 * as a session cookie and how the refresh route rejects an access
 * token as a refresh trigger.
 *
 * Tokens minted before the `use` claim landed have NO `use` payload
 * field. We refuse those outright rather than treating them as
 * `access` — the prior fallback let still-live legacy refresh JWTs
 * (already persisted in `nx_member_sessions` per #45's fix) be
 * smuggled into the session cookie and pass the access check (#91
 * reopen). The cost: members logged in before this deploy must log
 * in once. That's bounded by the access-token TTL (default 2h);
 * legacy session rows that don't match a new login age out via
 * `expiresAt` within 7 days regardless.
 */
export async function verifyMemberToken(
  token: string,
  secret: string,
  expectedUse?: NpMemberTokenUse,
): Promise<NpMemberTokenPayload> {
  const secretKey = textEncoder.encode(secret);
  const { payload } = await jwtVerify(token, secretKey, { audience: MEMBER_AUDIENCE });
  // jwtVerify already validated `aud === MEMBER_AUDIENCE`; cast through
  // JWTPayload to lock in the fields we know land on member tokens.
  const typed = payload as JWTPayload & {
    sub: string;
    ver: number;
    iat: number;
    exp: number;
    use?: NpMemberTokenUse;
  };
  if (typed.use !== "access" && typed.use !== "refresh") {
    throw new NpAuthError("Member token missing `use` claim");
  }
  const use: NpMemberTokenUse = typed.use;
  if (expectedUse && use !== expectedUse) {
    // Throw `NpAuthError` so the response mapper emits 401 instead of
    // a plain 500 — this is an auth failure, not a server failure.
    throw new NpAuthError(
      `Member token use mismatch: expected ${expectedUse}, got ${use}`,
    );
  }
  return { ...typed, aud: MEMBER_AUDIENCE, use };
}
