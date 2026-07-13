import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  npAuthContractLimits,
  npAuthRuntimeDefaults,
  npReadAuthPositiveInteger,
  npRequireAuthSecret,
} from "../auth-contract/index.js";

/**
 * HMAC-signed state tokens for the OAuth start ↔ callback handshake.
 * The framework (not the provider) issues + verifies these — providers
 * only see them as opaque strings.
 *
 * Token shape: `<base64url(payload)>.<base64url(hmac)>` where payload is
 * JSON `{ providerId, nonce, expSeconds, codeVerifier }`. Using an HMAC
 * instead of a JWT keeps this self-contained — no jose import, no key
 * rotation surface — and the payload stays comfortably under the
 * cookie size cap.
 *
 * The `codeVerifier` is a 32-byte URL-safe random string that providers
 * supporting PKCE (Google, etc.) hash into the authorize URL. Providers
 * that don't use PKCE (GitHub) ignore it. We always generate one so the
 * flow is uniform.
 *
 * Default state TTL is 10 minutes — long enough for slow IdP redirects
 * (corporate SSO with MFA prompts), short enough that a stale state
 * cookie doesn't sit around forever. Override via
 * `NP_OAUTH_STATE_TTL_SECONDS`.
 */

const CODE_VERIFIER_BYTES = 32;

export interface OAuthStatePayload {
  providerId: string;
  nonce: string;
  expSeconds: number;
  codeVerifier: string;
}

export interface IssuedOAuthState {
  /** The serialized state token (cookie + redirect query value). */
  token: string;
  /** The PKCE verifier — also embedded in the token, surfaced here so
   *  the route can pass it to `provider.authorize()` without re-parsing. */
  codeVerifier: string;
  /** Exact cookie lifetime matching the signed payload expiry. */
  expiresInSeconds: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueOAuthState(providerId: string, secret: string): IssuedOAuthState {
  const signingSecret = npRequireAuthSecret(secret);
  const expiresInSeconds = npReadAuthPositiveInteger(
    "NP_OAUTH_STATE_TTL_SECONDS",
    process.env.NP_OAUTH_STATE_TTL_SECONDS,
    npAuthRuntimeDefaults.oauthStateTtlSeconds,
    npAuthContractLimits.oauthStateTtlSeconds,
  );
  const nonce = randomBytes(16).toString("base64url");
  const codeVerifier = randomBytes(CODE_VERIFIER_BYTES).toString("base64url");
  const expSeconds = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload: OAuthStatePayload = { providerId, nonce, expSeconds, codeVerifier };
  const encoded = b64url(JSON.stringify(payload));
  const sig = sign(encoded, signingSecret);
  return { token: `${encoded}.${sig}`, codeVerifier, expiresInSeconds };
}

export interface VerifyOAuthStateResult {
  ok: boolean;
  payload?: OAuthStatePayload;
  reason?: "format" | "signature" | "expired";
}

/**
 * Strict verification:
 *  - Format must be `<payload>.<sig>` with two segments.
 *  - HMAC must match (constant-time compare).
 *  - `expSeconds` must be in the future.
 *  - `providerId` in the payload must match the route's expected provider.
 *  - `codeVerifier` must be a non-empty string.
 */
export function verifyOAuthState(
  token: string,
  expectedProviderId: string,
  secret: string,
): VerifyOAuthStateResult {
  const signingSecret = npRequireAuthSecret(secret);
  if (typeof token !== "string") {
    return { ok: false, reason: "format" };
  }
  const segments = token.split(".");
  if (segments.length !== 2) {
    return { ok: false, reason: "format" };
  }
  const [encoded, sig] = segments as [string, string];
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || !/^[A-Za-z0-9_-]{43}$/u.test(sig)) {
    return { ok: false, reason: "format" };
  }
  const expectedSig = sign(encoded, signingSecret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "format" };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "format" };
  }
  const record = payload as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    !["providerId", "nonce", "expSeconds", "codeVerifier"].every((key) => key in record) ||
    typeof record.providerId !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/u.test(String(record.nonce)) ||
    !Number.isSafeInteger(record.expSeconds) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(String(record.codeVerifier))
  ) {
    return { ok: false, reason: "format" };
  }
  const typed = record as unknown as OAuthStatePayload;

  if (typed.providerId !== expectedProviderId) {
    return { ok: false, reason: "signature" };
  }

  if (typed.expSeconds <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: typed };
}
