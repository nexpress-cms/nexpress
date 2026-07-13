import { randomBytes, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT, errors as joseErrors } from "jose";

import {
  npRequireStaffTokenPayload,
  npRequireAuthSecret,
  type NpAuthTokenUse,
  type NpStaffTokenPayload,
} from "../auth-contract/index.js";
import { NpAuthError } from "../errors.js";

/**
 * Staff-side JWT helpers. Both access (`np-session`) and refresh
 * (`np-refresh`) cookies are signed with this module; the
 * `use: "access" | "refresh"` claim separates them so a stolen
 * refresh JWT cannot be replayed as a session cookie. Without this
 * separation a leaked 7-day refresh became a 7-day admin bearer
 * because both cookies decoded to the same `{ sub, role, ver }`
 * payload through `verifyToken` (#94).
 *
 * The fix mirrors the member-side fix from #92/#93: the `use` claim
 * is required, with no legacy fallback for tokens missing the claim.
 * The paired-session migration deliberately removes legacy rows, so
 * the deployment requires one fresh login.
 */
export type NpTokenUse = NpAuthTokenUse;
export type NpTokenPayload = NpStaffTokenPayload;

const textEncoder = new TextEncoder();

export async function signToken(
  user: { id: string; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
  tokenUse: NpTokenUse = "access",
  sessionId: string = randomUUID(),
): Promise<string> {
  if (!Number.isSafeInteger(expirationSeconds) || expirationSeconds <= 0) {
    throw new Error("Staff token expiration must be a positive integer number of seconds.");
  }
  const secretKey = textEncoder.encode(npRequireAuthSecret(secret));
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = npRequireStaffTokenPayload({
    sub: user.id,
    aud: "staff",
    ver: user.tokenVersion,
    use: tokenUse,
    sid: sessionId,
    jti: randomBytes(16).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + expirationSeconds,
  });

  return new SignJWT({
    ver: payload.ver,
    use: payload.use,
    sid: payload.sid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setAudience(payload.aud)
    .setJti(payload.jti)
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .sign(secretKey);
}

/**
 * Verify a staff JWT. When `expectedUse` is provided, refuses tokens
 * whose `use` claim doesn't match — that's how `getSessionUser`
 * rejects a refresh token used as a session cookie and how the
 * refresh route rejects an access token as a refresh trigger.
 *
 * Tokens minted before the exact auth contract have no `use`, `aud`,
 * or `sid` claim. We refuse them outright rather than inferring claims;
 * migration removes their legacy rows and requires one fresh login.
 */
export async function verifyToken(
  token: string,
  secret: string,
  expectedUse?: NpTokenUse,
): Promise<NpTokenPayload> {
  const secretKey = textEncoder.encode(npRequireAuthSecret(secret));
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ["HS256"],
    audience: "staff",
  });
  let typed: NpStaffTokenPayload;
  try {
    typed = npRequireStaffTokenPayload(payload);
  } catch (error) {
    throw new NpAuthError(error instanceof Error ? error.message : "Invalid staff token claims");
  }
  if (expectedUse && typed.use !== expectedUse) {
    throw new NpAuthError(`Staff token use mismatch: expected ${expectedUse}, got ${typed.use}`);
  }
  return typed;
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
