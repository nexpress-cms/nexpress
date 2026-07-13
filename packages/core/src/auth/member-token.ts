import { randomBytes, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

import {
  npRequireMemberTokenPayload,
  npRequireAuthSecret,
  type NpAuthTokenUse,
  type NpMemberTokenPayload,
} from "../auth-contract/index.js";
import { NpAuthError } from "../errors.js";

/**
 * Member-side JWT helpers. Mirrors `signToken` / `verifyToken` for
 * staff but adds a fixed `aud: "member"` claim so a forged JWT signed
 * for a staff user can't be replayed against member-only routes (and
 * vice-versa).
 *
 * The signing secret is the same `NP_SECRET`; rotating it invalidates
 * both staff and member sessions, which is the desired behavior.
 *
 * Every token gets a random `jti` so two tokens minted within the
 * same second for the same member produce DIFFERENT JWT strings —
 * needed for refresh-token rotation: without it, the rotated token
 * hash would collide with the prior token hash and revocation by
 * tokenHash would still resolve the rotated row.
 *
 * `use: "access" | "refresh"` separates the two token purposes. A
 * refresh JWT cannot be presented as the `np-mb-session` cookie and
 * a session JWT cannot drive the rotation endpoint — without this
 * separation a leaked refresh token effectively became a long-lived
 * bearer access token because both kinds were stored as fungible
 * rows in `np_member_sessions` with no row-level kind column.
 */
export type NpMemberTokenUse = NpAuthTokenUse;
export type { NpMemberTokenPayload };

const textEncoder = new TextEncoder();
const MEMBER_AUDIENCE = "member";

export async function signMemberToken(
  member: { id: string; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
  tokenUse: NpMemberTokenUse = "access",
  sessionId: string = randomUUID(),
): Promise<string> {
  if (!Number.isSafeInteger(expirationSeconds) || expirationSeconds <= 0) {
    throw new Error("Member token expiration must be a positive integer number of seconds.");
  }
  const secretKey = textEncoder.encode(npRequireAuthSecret(secret));
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = npRequireMemberTokenPayload({
    sub: member.id,
    aud: MEMBER_AUDIENCE,
    ver: member.tokenVersion,
    use: tokenUse,
    sid: sessionId,
    jti: randomBytes(16).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + expirationSeconds,
  });
  return new SignJWT({ ver: payload.ver, use: payload.use, sid: payload.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setAudience(payload.aud)
    .setJti(payload.jti)
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .sign(secretKey);
}

/**
 * Verify a member JWT and return the parsed payload. When
 * `expectedUse` is provided, refuses tokens whose `use` claim doesn't
 * match — that's how `getSessionMember` rejects a refresh token used
 * as a session cookie and how the refresh route rejects an access
 * token as a refresh trigger.
 *
 * Tokens minted before the exact auth contract have no `use`, `aud`,
 * or `sid` claim. We refuse them outright rather than inferring claims;
 * migration removes their legacy rows and requires one fresh login.
 */
export async function verifyMemberToken(
  token: string,
  secret: string,
  expectedUse?: NpMemberTokenUse,
): Promise<NpMemberTokenPayload> {
  const secretKey = textEncoder.encode(npRequireAuthSecret(secret));
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ["HS256"],
    audience: MEMBER_AUDIENCE,
  });
  let typed: NpMemberTokenPayload;
  try {
    typed = npRequireMemberTokenPayload(payload);
  } catch (error) {
    throw new NpAuthError(error instanceof Error ? error.message : "Invalid member token claims");
  }
  if (expectedUse && typed.use !== expectedUse) {
    // Throw `NpAuthError` so the response mapper emits 401 instead of
    // a plain 500 — this is an auth failure, not a server failure.
    throw new NpAuthError(`Member token use mismatch: expected ${expectedUse}, got ${typed.use}`);
  }
  return typed;
}
