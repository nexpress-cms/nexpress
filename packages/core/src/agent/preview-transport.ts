import {
  createHmac,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";
import { isIP } from "node:net";
import { parse } from "tldts";

import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
  canonicalBodySha256Digest,
} from "../agent-contract/canonical-body-validation.js";
import { canonicalBodyPreviewRoute } from "../agent-contract/canonical-preview-values.js";
import type { NpAgentTokenHashKeyring } from "./opaque-verifier.js";

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const B64 = /^[A-Za-z0-9_-]+$/u;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FAIL = "Invalid Agent preview transport.";
function fail(): never {
  throw new Error(FAIL);
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !descriptors[key] || !("value" in descriptors[key]))
  )
    fail();
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 0, maximum = 2_147_483_647): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    fail();
  return value;
}
function base64(value: string, length?: number): Buffer {
  if (!B64.test(value) || value.length > 16_384) fail();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || (length !== undefined && bytes.length !== length))
    fail();
  return bytes;
}
function keyId(value: unknown): string {
  if (typeof value !== "string" || !KEY_ID.test(value)) fail();
  return value;
}

/** Deployment-only origin normalization. No development/cookie-domain exception exists. */
export function npRequireAgentPreviewOrigin(
  origin: unknown,
  servedOrigins: readonly string[],
): string {
  if (
    typeof origin !== "string" ||
    origin.length > 2048 ||
    !/^https:\/\/[^\s\\/?#]+\/?$/u.test(origin)
  )
    fail();
  const url = new URL(origin);
  if (
    url.username ||
    url.password ||
    url.hostname.endsWith(".") ||
    isIP(url.hostname.replace(/^\[|\]$/gu, ""))
  )
    fail();
  const preview = parse(url.hostname, { extractHostname: false, allowPrivateDomains: true });
  if (!preview.domain || !(preview.isIcann || preview.isPrivate)) fail();
  for (const served of servedOrigins) {
    const site = new URL(served);
    const domain = parse(site.hostname, { extractHostname: false, allowPrivateDomains: true });
    if (
      !domain.domain ||
      !(domain.isIcann || domain.isPrivate) ||
      isIP(site.hostname.replace(/^\[|\]$/gu, ""))
    )
      fail();
    if (
      domain.domain === preview.domain ||
      url.hostname === site.hostname ||
      url.hostname.endsWith(`.${site.hostname}`) ||
      site.hostname.endsWith(`.${url.hostname}`)
    )
      fail();
  }
  return url.origin;
}
export function npRequireAgentPreviewRenderOrigin(origin: unknown): string {
  if (typeof origin !== "string" || !/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin))
    fail();
  const url = new URL(origin);
  if (url.origin !== origin || integer(Number(url.port), 1, 65535) === 443) fail();
  return origin;
}

export interface NpAgentPreviewSigningKeyringV1 {
  active: { id: string; privateKey: KeyObject; publicKey: KeyObject };
  previous?: Readonly<Record<string, KeyObject>>;
}
export interface NpAgentPreviewViewerClaimsV1 {
  schemaVersion: "np.agent-preview-token.v1";
  intent: "viewer";
  issuer: string;
  audience: string;
  siteId: string;
  changeSetId: string;
  previewId: string;
  planHash: string;
  allowedRoutesDigest: string;
  launchGeneration: number;
  launchId: string;
  viewer: {
    kind: "staff";
    userId: string;
    sessionFingerprint: string;
    userTokenVersion: number;
    siteAuthorizationDigest: string;
  };
  iat: number;
  exp: number;
}
export interface NpAgentPreviewRenderClaimsV1 {
  schemaVersion: "np.agent-preview-render-token.v1";
  intent: "render";
  issuer: string;
  audience: "urn:nexpress:preview-render";
  siteId: string;
  previewId: string;
  generation: number;
  planHash: string;
  allowedRoutesDigest: string;
  previewContractFingerprint: string;
  renderAttemptId: string;
  renderSessionId: string;
  jti: string;
  iat: number;
  exp: number;
}
export type NpAgentPreviewClaimsV1 = NpAgentPreviewViewerClaimsV1 | NpAgentPreviewRenderClaimsV1;
function requireClaims(input: unknown, intent: "viewer" | "render"): NpAgentPreviewClaimsV1 {
  const shared = [
    "schemaVersion",
    "intent",
    "issuer",
    "audience",
    "siteId",
    "previewId",
    "planHash",
    "allowedRoutesDigest",
    "iat",
    "exp",
  ];
  const body = exact(
    input,
    shared.concat(
      intent === "viewer"
        ? ["changeSetId", "launchGeneration", "launchId", "viewer"]
        : ["generation", "previewContractFingerprint", "renderAttemptId", "renderSessionId", "jti"],
    ),
  );
  if (
    body.intent !== intent ||
    body.schemaVersion !==
      (intent === "viewer" ? "np.agent-preview-token.v1" : "np.agent-preview-render-token.v1")
  )
    fail();
  const siteId = canonicalBodySiteId(body.siteId, "siteId");
  canonicalBodyUuid(body.previewId, "previewId");
  canonicalBodySha256Digest(body.planHash, "planHash");
  canonicalBodySha256Digest(body.allowedRoutesDigest, "allowedRoutesDigest");
  const iat = integer(body.iat);
  const exp = integer(body.exp);
  if (exp <= iat || exp - iat > (intent === "viewer" ? 300 : 120)) fail();
  if (intent === "viewer") {
    if (
      npRequireAgentPreviewOrigin(body.issuer, []) !== body.issuer ||
      body.audience !== `urn:nexpress:preview:${siteId}`
    )
      fail();
    canonicalBodyUuid(body.changeSetId, "changeSetId");
    canonicalBodyUuid(body.launchId, "launchId");
    integer(body.launchGeneration, 1);
    const viewer = exact(body.viewer, [
      "kind",
      "userId",
      "sessionFingerprint",
      "userTokenVersion",
      "siteAuthorizationDigest",
    ]);
    if (
      viewer.kind !== "staff" ||
      typeof viewer.sessionFingerprint !== "string" ||
      !/^psf1:hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9_-]{43}$/u.test(
        viewer.sessionFingerprint,
      )
    )
      fail();
    base64(viewer.sessionFingerprint.split(":")[3], 32);
    canonicalBodyUuid(viewer.userId, "userId");
    integer(viewer.userTokenVersion);
    canonicalBodySha256Digest(viewer.siteAuthorizationDigest, "siteAuthorizationDigest");
  } else {
    npRequireAgentPreviewRenderOrigin(body.issuer);
    if (body.audience !== "urn:nexpress:preview-render") fail();
    integer(body.generation, 1);
    for (const key of ["renderAttemptId", "renderSessionId", "jti"])
      canonicalBodyUuid(body[key], key);
    canonicalBodySha256Digest(body.previewContractFingerprint, "previewContractFingerprint");
  }
  return body as unknown as NpAgentPreviewClaimsV1;
}
function requireSigningKey(key: KeyObject, privateKey = false): void {
  if (key.asymmetricKeyType !== "ed25519" || key.type !== (privateKey ? "private" : "public"))
    fail();
}
export function npSignAgentPreviewTokenV1(
  claims: NpAgentPreviewClaimsV1,
  keyring: NpAgentPreviewSigningKeyringV1,
): string {
  const checked = requireClaims(claims, claims.intent);
  keyId(keyring.active.id);
  requireSigningKey(keyring.active.privateKey, true);
  requireSigningKey(keyring.active.publicKey);
  const header = {
    alg: "EdDSA",
    typ: checked.intent === "viewer" ? "np-preview+jwt" : "np-preview-render+jwt",
    kid: keyring.active.id,
  };
  const data = `${Buffer.from(serializeAgentCanonicalJson(header)).toString("base64url")}.${Buffer.from(serializeAgentCanonicalJson(checked)).toString("base64url")}`;
  return `${data}.${sign(null, Buffer.from(data), keyring.active.privateKey).toString("base64url")}`;
}
/** Signature verification is deliberately not live authority; callers must recheck persisted state. */
export function npVerifyAgentPreviewTokenV1(input: {
  token: string;
  intent: "viewer" | "render";
  issuer: string;
  keyring: NpAgentPreviewSigningKeyringV1;
  now: Date;
  expectedKid?: string;
}): NpAgentPreviewClaimsV1 | null {
  try {
    if (typeof input.token !== "string" || input.token.length > 16_384) return null;
    const parts = input.token.split(".");
    if (parts.length !== 3) return null;
    const decode = (part: string): unknown => {
      const bytes = base64(part);
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const value: unknown = JSON.parse(raw);
      if (serializeAgentCanonicalJson(value) !== raw) fail();
      return value;
    };
    const header = exact(decode(parts[0]), ["alg", "typ", "kid"]);
    if (
      header.alg !== "EdDSA" ||
      header.typ !== (input.intent === "viewer" ? "np-preview+jwt" : "np-preview-render+jwt")
    )
      return null;
    const kid = keyId(header.kid);
    if (input.expectedKid !== undefined && input.expectedKid !== kid) return null;
    const publicKey =
      kid === input.keyring.active.id
        ? input.keyring.active.publicKey
        : input.keyring.previous?.[kid];
    if (!publicKey) return null;
    requireSigningKey(publicKey);
    if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, base64(parts[2], 64)))
      return null;
    const claims = requireClaims(decode(parts[1]), input.intent);
    const now = Math.floor(input.now.getTime() / 1000);
    if (
      !Number.isSafeInteger(now) ||
      claims.issuer !== input.issuer ||
      now < claims.iat - 60 ||
      now >= claims.exp + 60
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

const DOMAINS = {
  psf1: "np-agent-staff-session-fingerprint/v1",
  lxv1: "np-agent-preview-launch-exchange/v1",
  rcv1: "np-agent-preview-render-cookie/v1",
  ctv1: "np-agent-preview-capture-ticket/v1",
} as const;
type PreviewHmacPurpose = keyof typeof DOMAINS;
function frame(parts: readonly (string | Uint8Array)[]): Buffer {
  return Buffer.concat(
    parts.flatMap((value) => {
      const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(bytes.length);
      return [prefix, bytes];
    }),
  );
}
function requireHmacKey(keyring: NpAgentTokenHashKeyring, id: string): Uint8Array {
  keyId(keyring.active.id);
  if (keyring.active.key.byteLength !== 32) fail();
  for (const [previousId, key] of Object.entries(keyring.previous ?? {})) {
    keyId(previousId);
    if (key.byteLength !== 32 || previousId === keyring.active.id) fail();
  }
  const key = id === keyring.active.id ? keyring.active.key : keyring.previous?.[id];
  if (!key) fail();
  return key;
}
function hmac(
  purpose: PreviewHmacPurpose,
  parts: readonly (string | Uint8Array)[],
  keyring: NpAgentTokenHashKeyring,
  id = keyring.active.id,
): string {
  return `${purpose}:hmac-sha256:${id}:${createHmac("sha256", requireHmacKey(keyring, id))
    .update(frame([DOMAINS[purpose], ...parts]))
    .digest("base64url")}`;
}
function matches(
  purpose: PreviewHmacPurpose,
  parts: readonly (string | Uint8Array)[],
  verifier: string,
  keyring: NpAgentTokenHashKeyring,
): boolean {
  try {
    const pieces = verifier.split(":");
    if (pieces.length !== 4 || pieces[0] !== purpose || pieces[1] !== "hmac-sha256") return false;
    keyId(pieces[2]);
    base64(pieces[3], 32);
    const expected = Buffer.from(hmac(purpose, parts, keyring, pieces[2]));
    const actual = Buffer.from(verifier);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
export function npAgentPreviewSessionFingerprintV1(input: {
  siteId: string;
  userId: string;
  sessionId: string;
  keyring: NpAgentTokenHashKeyring;
  keyId?: string;
}): string {
  canonicalBodySiteId(input.siteId, "siteId");
  canonicalBodyUuid(input.userId, "userId");
  canonicalBodyUuid(input.sessionId, "sessionId");
  return hmac("psf1", [input.siteId, input.userId, input.sessionId], input.keyring, input.keyId);
}
export function npVerifyAgentPreviewSessionFingerprintV1(input: {
  siteId: string;
  userId: string;
  sessionId: string;
  fingerprint: string;
  keyring: NpAgentTokenHashKeyring;
}): boolean {
  return matches(
    "psf1",
    [input.siteId, input.userId, input.sessionId],
    input.fingerprint,
    input.keyring,
  );
}
export type NpAgentPreviewSecretContextV1 =
  | { purpose: "launch"; siteId: string; previewId: string; launchId: string }
  | { purpose: "render-cookie"; siteId: string; previewId: string; renderSessionId: string }
  | {
      purpose: "capture";
      siteId: string;
      previewId: string;
      renderSessionId: string;
      renderAttemptId: string;
      ordinal: number;
    };
function secretContext(input: NpAgentPreviewSecretContextV1): {
  purpose: PreviewHmacPurpose;
  prefix: string;
  id: string;
  parts: string[];
} {
  canonicalBodySiteId(input.siteId, "siteId");
  canonicalBodyUuid(input.previewId, "previewId");
  if (input.purpose === "launch") {
    canonicalBodyUuid(input.launchId, "launchId");
    return {
      purpose: "lxv1",
      prefix: "nplx1",
      id: input.launchId,
      parts: [input.siteId, input.previewId, input.launchId],
    };
  }
  canonicalBodyUuid(input.renderSessionId, "renderSessionId");
  if (input.purpose === "render-cookie")
    return {
      purpose: "rcv1",
      prefix: "nprc1",
      id: input.renderSessionId,
      parts: [input.siteId, input.previewId, input.renderSessionId],
    };
  canonicalBodyUuid(input.renderAttemptId, "renderAttemptId");
  integer(input.ordinal, 1, 20);
  return {
    purpose: "ctv1",
    prefix: "npct1",
    id: String(input.ordinal),
    parts: [
      input.siteId,
      input.previewId,
      input.renderSessionId,
      input.renderAttemptId,
      String(input.ordinal),
    ],
  };
}
export function npMintAgentPreviewSecretV1(
  context: NpAgentPreviewSecretContextV1,
  keyring: NpAgentTokenHashKeyring,
): { value: string; verifier: string; keyId: string } {
  const data = secretContext(context);
  const secret = randomBytes(32);
  try {
    return {
      value: `${data.prefix}_${data.id}_${secret.toString("base64url")}`,
      verifier: hmac(data.purpose, [...data.parts, secret], keyring),
      keyId: keyring.active.id,
    };
  } finally {
    secret.fill(0);
  }
}
export function npVerifyAgentPreviewSecretV1(
  context: NpAgentPreviewSecretContextV1,
  value: string,
  verifier: string,
  keyring: NpAgentTokenHashKeyring,
): boolean {
  let secret: Buffer | undefined;
  try {
    const data = secretContext(context);
    const prefix = `${data.prefix}_${data.id}_`;
    if (!value.startsWith(prefix)) return false;
    secret = base64(value.slice(prefix.length), 32);
    return matches(data.purpose, [...data.parts, secret], verifier, keyring);
  } catch {
    return false;
  } finally {
    secret?.fill(0);
  }
}
export function npAgentPreviewOpaquePublicIdV1(
  value: string,
  purpose: "launch" | "render-cookie",
): string | null {
  const prefix = purpose === "launch" ? "nplx1_" : "nprc1_";
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    value.length !== prefix.length + 36 + 1 + 43
  )
    return null;
  const id = value.slice(prefix.length, prefix.length + 36);
  try {
    if (!UUID.test(id) || value[prefix.length + 36] !== "_") return null;
    base64(value.slice(prefix.length + 37), 32);
    return id;
  } catch {
    return null;
  }
}

export function npAgentPreviewNonce(): string {
  return randomBytes(24).toString("base64url");
}
export function npAgentChangeSetPreviewCsp(nonce: string): string {
  if (!NONCE.test(nonce)) fail();
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'`;
}
export function npAgentPreviewHtmlHeaders(nonce: string): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    pragma: "no-cache",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": npAgentChangeSetPreviewCsp(nonce),
  };
}
export function npAgentPreviewArtifactHeaders(input: {
  artifactId: string;
  mime: "image/png" | "image/webp" | "application/json";
  size: number;
  contentDigest: string;
  nonce: string;
}): Record<string, string> {
  canonicalBodyUuid(input.artifactId, "artifactId");
  if (!/^ac1:sha256:[A-Za-z0-9_-]{43}$/u.test(input.contentDigest)) fail();
  base64(input.contentDigest.split(":")[2], 32);
  const report = input.mime === "application/json";
  if (!report && input.mime !== "image/png" && input.mime !== "image/webp") fail();
  integer(input.size, 1, report ? 512 * 1024 : 2 * 1024 * 1024);
  const extension = report ? "json" : input.mime === "image/png" ? "png" : "webp";
  return {
    ...npAgentPreviewHtmlHeaders(input.nonce),
    "content-type": report ? "application/json; charset=utf-8" : input.mime,
    "content-disposition": `${report ? "attachment" : "inline"}; filename="np-preview-${input.artifactId}.${extension}"`,
    "content-length": String(input.size),
    etag: `"${input.contentDigest}"`,
  };
}
export function npAgentPreviewViewerPath(input: {
  previewId: string;
  launchId: string;
  route: string;
}): string {
  canonicalBodyUuid(input.previewId, "previewId");
  canonicalBodyUuid(input.launchId, "launchId");
  canonicalBodyPreviewRoute(input.route, "route");
  return `/__np/view/${input.previewId}/${input.launchId}/${encodeURIComponent(input.route)}`;
}
export function npAgentPreviewViewerCookie(
  input:
    | { previewId: string; token: string; expiresAt: Date; now: Date }
    | { previewId: string; clear: true },
): string {
  canonicalBodyUuid(input.previewId, "previewId");
  const name = `__Secure-np-preview-${input.previewId.replaceAll("-", "")}`;
  const path = `/__np/view/${input.previewId}/`;
  return cookie(name, path, input, 300);
}
export function npAgentPreviewRenderCookie(
  input:
    | { renderSessionId: string; token: string; expiresAt: Date; now: Date }
    | { renderSessionId: string; clear: true },
): string {
  canonicalBodyUuid(input.renderSessionId, "renderSessionId");
  return cookie(
    "np-preview-render",
    `/__np/preview/render-route/${input.renderSessionId}/`,
    input,
    120,
  );
}
function cookie(
  name: string,
  path: string,
  input: { token: string; expiresAt: Date; now: Date } | { clear: true },
  maximum: number,
): string {
  if ("clear" in input)
    return `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Strict`;
  if (!/^[A-Za-z0-9_.-]{1,16384}$/u.test(input.token)) fail();
  const age = Math.floor((input.expiresAt.getTime() - input.now.getTime()) / 1000);
  integer(age, 1, maximum);
  return `${name}=${input.token}; Path=${path}; Max-Age=${age}; Expires=${input.expiresAt.toUTCString()}; Secure; HttpOnly; SameSite=Strict`;
}
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
export function npAgentPreviewLaunchBridge(input: {
  previewOrigin: string;
  exchange: string;
  nonce: string;
}): { html: string; headers: Record<string, string> } {
  const origin = npRequireAgentPreviewOrigin(input.previewOrigin, []);
  if (!npAgentPreviewOpaquePublicIdV1(input.exchange, "launch")) fail();
  const headers = npAgentPreviewHtmlHeaders(input.nonce);
  // Fetch serializes non-CORS POST Origin as null under no-referrer. This trusted
  // production bridge shares only its origin; all isolated responses remain no-referrer.
  headers["referrer-policy"] = "origin";
  headers["content-security-policy"] =
    `default-src 'none'; script-src 'nonce-${input.nonce}'; base-uri 'none'; form-action ${origin}; frame-ancestors 'none'`;
  return {
    headers,
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Open preview</title></head><body><form id="np-preview-launch" method="post" action="${escapeHtml(origin)}/__np/launch"><input type="hidden" name="exchange" value="${escapeHtml(input.exchange)}"><button type="submit">Open preview</button></form><script nonce="${input.nonce}">document.getElementById("np-preview-launch").submit()</script></body></html>`,
  };
}
export function npAgentPreviewActivationPage(input: {
  previewId: string;
  launchId: string;
  route: string;
  nonce: string;
}): { html: string; headers: Record<string, string> } {
  const path = npAgentPreviewViewerPath(input);
  const headers = npAgentPreviewHtmlHeaders(input.nonce);
  headers["content-security-policy"] =
    `default-src 'none'; script-src 'nonce-${input.nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return {
    headers,
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Continue to preview</title></head><body><a href="${escapeHtml(path)}">Continue to preview</a><script nonce="${input.nonce}">location.replace(${JSON.stringify(path)})</script></body></html>`,
  };
}
