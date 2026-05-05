import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT, errors as joseErrors, type JWTPayload } from "jose";

import type { NpUserRole } from "../config/types.js";
import { NpAuthError } from "../errors.js";

/**
 * Staff-side JWT helpers. Both access (`nx-session`) and refresh
 * (`nx-refresh`) cookies are signed with this module; the
 * `use: "access" | "refresh"` claim separates them so a stolen
 * refresh JWT cannot be replayed as a session cookie. Without this
 * separation a leaked 7-day refresh became a 7-day admin bearer
 * because both cookies decoded to the same `{ sub, role, ver }`
 * payload through `verifyToken` (#94).
 *
 * The fix mirrors the member-side fix from #92/#93: the `use` claim
 * is required, no legacy fallback for tokens missing the claim. The
 * cost is one forced re-login for staff sessions issued before the
 * deploy; bounded by the 7-day refresh TTL.
 */
export type NpTokenUse = "access" | "refresh";

export interface NpTokenPayload {
  sub: string;
  role: NpUserRole;
  ver: number;
  /** Required. `verifyToken` refuses tokens missing this claim so
   *  legacy refresh JWTs cannot be smuggled into the session
   *  cookie path. */
  use: NpTokenUse;
  /** Random per-token id — needed if rotation lands on the staff
   *  side (mirrors the member-side `jti` for #45). Optional today
   *  but populated on every newly-minted token. */
  jti?: string;
  iat: number;
  exp: number;
}

const textEncoder = new TextEncoder();

export async function signToken(
  user: { id: string; role: NpUserRole; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
  tokenUse: NpTokenUse = "access",
): Promise<string> {
  const secretKey = textEncoder.encode(secret);

  return new SignJWT({
    sub: user.id,
    role: user.role,
    ver: user.tokenVersion,
    use: tokenUse,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomBytes(16).toString("base64url"))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expirationSeconds)
    .sign(secretKey);
}

/**
 * Verify a staff JWT. When `expectedUse` is provided, refuses tokens
 * whose `use` claim doesn't match — that's how `getSessionUser`
 * rejects a refresh token used as a session cookie and how the
 * refresh route rejects an access token as a refresh trigger.
 *
 * Tokens minted before the `use` claim landed have NO `use` payload
 * field. We refuse those outright rather than treating them as
 * `access` — the prior fallback would let still-live legacy refresh
 * JWTs be smuggled into the session cookie and pass the access
 * check. Cost: staff logged in before this deploy must log in once.
 * Bounded by the refresh-token TTL (default 7 days).
 */
export async function verifyToken(
  token: string,
  secret: string,
  expectedUse?: NpTokenUse,
): Promise<NpTokenPayload> {
  const secretKey = textEncoder.encode(secret);
  const { payload } = await jwtVerify(token, secretKey);
  const typed = payload as JWTPayload & {
    sub: string;
    role: NpUserRole;
    ver: number;
    iat: number;
    exp: number;
    use?: NpTokenUse;
  };
  if (typed.use !== "access" && typed.use !== "refresh") {
    throw new NpAuthError("Staff token missing `use` claim");
  }
  const use: NpTokenUse = typed.use;
  if (expectedUse && use !== expectedUse) {
    throw new NpAuthError(
      `Staff token use mismatch: expected ${expectedUse}, got ${use}`,
    );
  }
  return { ...typed, use };
}

/**
 * True when `err` represents a token-verification failure rather than
 * an unrelated runtime fault (DB outage, misconfiguration, …). Auth
 * helpers use this to keep the existing "bad token → 401" behavior
 * silent while letting infrastructure failures surface as 5xx.
 *
 * Covers:
 *   - `NpAuthError` — `verifyToken` / `verifyMemberToken` rejecting a
 *     missing or wrong `use` claim, or `verifyCsrf` failing.
 *   - `jose.errors.JOSEError` — every JWT signature / format /
 *     expiration failure, including subclasses like `JWTExpired`,
 *     `JWSSignatureVerificationFailed`, `JWTInvalid`.
 */
export function isTokenVerificationError(err: unknown): boolean {
  if (err instanceof NpAuthError) return true;
  if (err instanceof joseErrors.JOSEError) return true;
  return false;
}
