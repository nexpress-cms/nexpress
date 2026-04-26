import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

import type { NxUserRole } from "../config/types.js";
import { NxAuthError } from "../errors.js";

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
export type NxTokenUse = "access" | "refresh";

export interface NxTokenPayload {
  sub: string;
  role: NxUserRole;
  ver: number;
  /** Required. `verifyToken` refuses tokens missing this claim so
   *  legacy refresh JWTs cannot be smuggled into the session
   *  cookie path. */
  use: NxTokenUse;
  /** Random per-token id — needed if rotation lands on the staff
   *  side (mirrors the member-side `jti` for #45). Optional today
   *  but populated on every newly-minted token. */
  jti?: string;
  iat: number;
  exp: number;
}

const textEncoder = new TextEncoder();

export async function signToken(
  user: { id: string; role: NxUserRole; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
  tokenUse: NxTokenUse = "access",
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
  expectedUse?: NxTokenUse,
): Promise<NxTokenPayload> {
  const secretKey = textEncoder.encode(secret);
  const { payload } = await jwtVerify(token, secretKey);
  const typed = payload as JWTPayload & {
    sub: string;
    role: NxUserRole;
    ver: number;
    iat: number;
    exp: number;
    use?: NxTokenUse;
  };
  if (typed.use !== "access" && typed.use !== "refresh") {
    throw new NxAuthError("Staff token missing `use` claim");
  }
  const use: NxTokenUse = typed.use;
  if (expectedUse && use !== expectedUse) {
    throw new NxAuthError(
      `Staff token use mismatch: expected ${expectedUse}, got ${use}`,
    );
  }
  return { ...typed, use };
}
