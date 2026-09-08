import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentPreviewOrigin,
  npRequireAgentPreviewRenderOrigin,
  npSignAgentPreviewTokenV1,
  npVerifyAgentPreviewTokenV1,
  npAgentPreviewSessionFingerprintV1,
  npVerifyAgentPreviewSessionFingerprintV1,
  npMintAgentPreviewSecretV1,
  npVerifyAgentPreviewSecretV1,
  npAgentPreviewOpaquePublicIdV1,
  npAgentChangeSetPreviewCsp,
  npAgentPreviewArtifactHeaders,
  npAgentPreviewViewerCookie,
  npAgentPreviewRenderCookie,
  npAgentPreviewLaunchBridge,
  npAgentPreviewActivationPage,
  type NpAgentPreviewViewerClaimsV1,
} from "./preview-transport.js";
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const key = { active: { id: "preview.1", key: new Uint8Array(32).fill(1) } };
const keys = { active: { id: "sign-1", ...generateKeyPairSync("ed25519") } };
const now = new Date("2026-09-08T00:00:00.000Z");
const iat = Math.floor(now.getTime() / 1000);
const fingerprint = npAgentPreviewSessionFingerprintV1({
  siteId: "default",
  userId: id,
  sessionId: other,
  keyring: key,
});
const claims: NpAgentPreviewViewerClaimsV1 = {
  schemaVersion: "np.agent-preview-token.v1",
  intent: "viewer",
  issuer: "https://preview.example.net",
  audience: "urn:nexpress:preview:default",
  siteId: "default",
  changeSetId: id,
  previewId: id,
  planHash: hash,
  allowedRoutesDigest: hash,
  launchGeneration: 1,
  launchId: id,
  viewer: {
    kind: "staff",
    userId: id,
    sessionFingerprint: fingerprint,
    userTokenVersion: 1,
    siteAuthorizationDigest: hash,
  },
  iat,
  exp: iat + 300,
};
const nonce = "a".repeat(32);
function signed(header: unknown, body: unknown, raw?: string) {
  const data = `${Buffer.from(serializeAgentCanonicalJson(header)).toString("base64url")}.${Buffer.from(raw ?? serializeAgentCanonicalJson(body)).toString("base64url")}`;
  return `${data}.${sign(null, Buffer.from(data), keys.active.privateKey).toString("base64url")}`;
}
function verified(token: string, date = now) {
  return npVerifyAgentPreviewTokenV1({
    token,
    intent: "viewer",
    issuer: claims.issuer,
    keyring: keys,
    now: date,
  });
}
describe("isolated preview origin", () => {
  it("normalizes only a separate known registrable domain including private suffixes", () => {
    expect(
      npRequireAgentPreviewOrigin("https://preview.example.net:443/", [
        "https://admin.example.com",
      ]),
    ).toBe("https://preview.example.net");
    expect(npRequireAgentPreviewOrigin("https://one.github.io", ["https://two.github.io"])).toBe(
      "https://one.github.io",
    );
    expect(
      npRequireAgentPreviewOrigin("https://preview.example.co.uk", ["https://www.example.com"]),
    ).toBe("https://preview.example.co.uk");
  });
  it.each([
    "https://preview.example.com",
    "https://example.com",
    "http://preview.example.net",
    "https://127.0.0.1",
    "https://[::1]",
    "https://localhost",
    "https://preview.invalid",
    "https://user@preview.example.net",
    "https://preview.example.net/path",
    "https://preview.example.net?x",
    "https://preview.example.net#x",
    "https://preview.example.net.",
    " https://preview.example.net",
    "https://preview.example.net\\@example.org",
  ])("rejects unsafe origin %s", (origin) => {
    expect(() => npRequireAgentPreviewOrigin(origin, ["https://admin.example.com"])).toThrow();
  });
  it("accepts only a canonical explicit ephemeral loopback HTTPS origin", () => {
    expect(npRequireAgentPreviewRenderOrigin("https://127.0.0.1:39281")).toBe(
      "https://127.0.0.1:39281",
    );
    for (const origin of [
      "https://localhost:39281",
      "http://127.0.0.1:39281",
      "https://127.0.0.1:443",
      "https://127.0.0.1:65536",
      "https://127.0.0.1:39281/",
      "https://example.net:39281",
    ])
      expect(() => npRequireAgentPreviewRenderOrigin(origin)).toThrow();
  });
});
describe("purpose-separated preview cryptography", () => {
  it("round trips exact canonical Ed25519 viewer claims, preserving bounded skew", () => {
    const token = npSignAgentPreviewTokenV1(claims, keys);
    expect(verified(token)).toEqual(claims);
    expect(verified(token, new Date((iat - 60) * 1000))).toEqual(claims);
    expect(verified(token, new Date((iat - 61) * 1000))).toBeNull();
    expect(verified(token, new Date((claims.exp + 60) * 1000))).toBeNull();
    expect(
      npVerifyAgentPreviewTokenV1({
        token,
        intent: "render",
        issuer: claims.issuer,
        keyring: keys,
        now,
      }),
    ).toBeNull();
    expect(
      npVerifyAgentPreviewTokenV1({
        token,
        intent: "viewer",
        issuer: "https://other.example.net",
        keyring: keys,
        now,
      }),
    ).toBeNull();
  });
  it("rejects signed unknown/duplicate/noncanonical data, wrong headers, times, audiences and signature", () => {
    const header = { alg: "EdDSA", typ: "np-preview+jwt", kid: keys.active.id };
    const raw = serializeAgentCanonicalJson(claims);
    for (const token of [
      signed({ ...header, extra: true }, claims),
      signed({ ...header, alg: "HS256" }, claims),
      signed(header, { ...claims, exp: iat + 301 }),
      signed(header, { ...claims, hidden: "secret" }),
      signed(header, { ...claims, audience: "urn:nexpress:preview:other" }),
      signed(header, claims, ` ${raw}`),
      signed(
        header,
        claims,
        raw.replace('"intent":"viewer"', '"intent":"render","intent":"viewer"'),
      ),
      `${npSignAgentPreviewTokenV1(claims, keys)}=`,
    ])
      expect(verified(token)).toBeNull();
    const token = npSignAgentPreviewTokenV1(claims, keys);
    expect(verified(`${token.slice(0, -3)}AAA`)).toBeNull();
    expect(() =>
      npSignAgentPreviewTokenV1(claims, {
        active: { id: "rsa", ...generateKeyPairSync("rsa", { modulusLength: 2048 }) },
      }),
    ).toThrow();
  });
  it("retains explicit old public keys without fallback to another token family", () => {
    const token = npSignAgentPreviewTokenV1(claims, keys);
    const rotated = {
      active: { id: "sign-2", ...generateKeyPairSync("ed25519") },
      previous: { "sign-1": keys.active.publicKey },
    };
    expect(
      npVerifyAgentPreviewTokenV1({
        token,
        intent: "viewer",
        issuer: claims.issuer,
        keyring: rotated,
        now,
      }),
    ).toEqual(claims);
    expect(
      npVerifyAgentPreviewTokenV1({
        token,
        intent: "viewer",
        issuer: claims.issuer,
        keyring: { active: rotated.active },
        now,
      }),
    ).toBeNull();
  });
  it("binds session fingerprints to site, user, session and retained key", () => {
    expect(fingerprint).toBe(
      "psf1:hmac-sha256:preview.1:jZBFCV086D3lfNLYdT0GO_xILuO9wOa9QrhrdwRrwcA",
    );
    expect(
      npVerifyAgentPreviewSessionFingerprintV1({
        siteId: "default",
        userId: id,
        sessionId: other,
        fingerprint,
        keyring: key,
      }),
    ).toBe(true);
    expect(
      npVerifyAgentPreviewSessionFingerprintV1({
        siteId: "other",
        userId: id,
        sessionId: other,
        fingerprint,
        keyring: key,
      }),
    ).toBe(false);
    expect(
      npVerifyAgentPreviewSessionFingerprintV1({
        siteId: "default",
        userId: other,
        sessionId: id,
        fingerprint,
        keyring: key,
      }),
    ).toBe(false);
  });
  it("binds hash-only exchanges, cookies and capture tickets to their exact tuple", () => {
    const context = { purpose: "launch" as const, siteId: "default", previewId: id, launchId: id };
    const minted = npMintAgentPreviewSecretV1(context, key);
    expect(npAgentPreviewOpaquePublicIdV1(minted.value, "launch")).toBe(id);
    expect(npVerifyAgentPreviewSecretV1(context, minted.value, minted.verifier, key)).toBe(true);
    expect(
      npVerifyAgentPreviewSecretV1(
        { ...context, previewId: other },
        minted.value,
        minted.verifier,
        key,
      ),
    ).toBe(false);
    expect(
      npVerifyAgentPreviewSecretV1(
        { purpose: "render-cookie", siteId: "default", previewId: id, renderSessionId: id },
        minted.value,
        minted.verifier,
        key,
      ),
    ).toBe(false);
    expect(npAgentPreviewOpaquePublicIdV1(`${minted.value}=`, "launch")).toBeNull();
    const capture = {
      purpose: "capture" as const,
      siteId: "default",
      previewId: id,
      renderSessionId: id,
      renderAttemptId: other,
      ordinal: 1,
    };
    const ticket = npMintAgentPreviewSecretV1(capture, key);
    expect(npVerifyAgentPreviewSecretV1(capture, ticket.value, ticket.verifier, key)).toBe(true);
    expect(
      npVerifyAgentPreviewSecretV1({ ...capture, ordinal: 2 }, ticket.value, ticket.verifier, key),
    ).toBe(false);
  });
});
describe("preview response and one-time HTML builders", () => {
  it("locks CSP and exact artifact headers", () => {
    expect(npAgentChangeSetPreviewCsp(nonce)).toBe(
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'`,
    );
    const headers = npAgentPreviewArtifactHeaders({
      artifactId: id,
      mime: "image/png",
      size: 32,
      contentDigest: `ac1:sha256:${"A".repeat(43)}`,
      nonce,
    });
    expect(headers).toMatchObject({
      "cache-control": "private, no-store",
      pragma: "no-cache",
      "content-disposition": `inline; filename="np-preview-${id}.png"`,
      "content-length": "32",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow, noarchive",
    });
    expect(
      npAgentPreviewArtifactHeaders({
        artifactId: id,
        mime: "application/json",
        size: 32,
        contentDigest: `ac1:sha256:${"A".repeat(43)}`,
        nonce,
      })["content-type"],
    ).toBe("application/json; charset=utf-8");
    expect(() => npAgentChangeSetPreviewCsp("bad' ; connect-src *")).toThrow();
    expect(() =>
      npAgentPreviewArtifactHeaders({
        artifactId: `${id}\r\n`,
        mime: "image/png",
        size: 32,
        contentDigest: `ac1:sha256:${"A".repeat(43)}`,
        nonce,
      }),
    ).toThrow();
  });
  it("uses only path-bound Secure HttpOnly Strict cookies with bounded expiry", () => {
    const cookie = npAgentPreviewViewerCookie({
      previewId: id,
      token: "safe-token",
      now,
      expiresAt: new Date(now.getTime() + 300_000),
    });
    expect(cookie).toContain(`Path=/__np/view/${id}/; Max-Age=300;`);
    expect(cookie).not.toContain("Domain=");
    expect(cookie).toMatch(/; Secure; HttpOnly; SameSite=Strict$/u);
    expect(npAgentPreviewViewerCookie({ previewId: id, clear: true })).toContain(
      "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
    expect(
      npAgentPreviewRenderCookie({
        renderSessionId: id,
        token: "safe-token",
        now,
        expiresAt: new Date(now.getTime() + 120_000),
      }),
    ).toContain(`Path=/__np/preview/render-route/${id}/; Max-Age=120;`);
    expect(() =>
      npAgentPreviewViewerCookie({
        previewId: id,
        token: "safe-token",
        now,
        expiresAt: new Date(now.getTime() + 301_000),
      }),
    ).toThrow();
  });
  it("posts the exchange in trusted HTML and requires a second same-origin navigation", () => {
    const exchange = npMintAgentPreviewSecretV1(
      { purpose: "launch", siteId: "default", previewId: id, launchId: id },
      key,
    ).value;
    const bridge = npAgentPreviewLaunchBridge({ previewOrigin: claims.issuer, exchange, nonce });
    expect(bridge.headers["referrer-policy"]).toBe("origin");
    expect(bridge.html).toContain('method="post" action="https://preview.example.net/__np/launch"');
    expect(bridge.html).toContain(`name="exchange" value="${exchange}"`);
    expect(bridge.html).not.toContain(`?exchange=`);
    const activated = npAgentPreviewActivationPage({
      previewId: id,
      launchId: id,
      route: "/safe",
      nonce,
    });
    expect(activated.headers["referrer-policy"]).toBe("no-referrer");
    expect(activated.html).toContain(`location.replace("/__np/view/${id}/${id}/%2Fsafe")`);
    expect(activated.html).not.toContain(exchange);
    expect(activated.headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
  });
});
