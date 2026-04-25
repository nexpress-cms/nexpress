import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed state tokens for the OAuth start ↔ callback handshake.
 * The framework (not the provider) issues + verifies these — providers
 * only see them as opaque strings.
 *
 * Token shape: `<base64url(payload)>.<base64url(hmac)>` where payload is
 * `JSON.stringify({ p: providerId, n: nonce, e: expSeconds })`. Using
 * an HMAC instead of a JWT keeps this self-contained — no jose import,
 * no key rotation surface — and the payload is deliberately small so it
 * fits comfortably under the cookie size cap.
 */

const STATE_TTL_SECONDS = 600;

export interface OAuthStatePayload {
  providerId: string;
  nonce: string;
  expSeconds: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueOAuthState(providerId: string, secret: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const expSeconds = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const payload: OAuthStatePayload = { providerId, nonce, expSeconds };
  const encoded = b64url(JSON.stringify(payload));
  const sig = sign(encoded, secret);
  return `${encoded}.${sig}`;
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
 */
export function verifyOAuthState(
  token: string,
  expectedProviderId: string,
  secret: string,
): VerifyOAuthStateResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "format" };
  }
  const [encoded, sig] = token.split(".") as [string, string];
  if (!encoded || !sig) {
    return { ok: false, reason: "format" };
  }
  const expectedSig = sign(encoded, secret);
  // Buffer-equal length check first so timingSafeEqual doesn't throw.
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "signature" };
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "format" };
  }

  if (
    !payload ||
    typeof payload.providerId !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.expSeconds !== "number"
  ) {
    return { ok: false, reason: "format" };
  }

  if (payload.providerId !== expectedProviderId) {
    return { ok: false, reason: "signature" };
  }

  if (payload.expSeconds <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
