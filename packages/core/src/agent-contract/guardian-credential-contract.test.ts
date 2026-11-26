import { describe, expect, it, vi } from "vitest";
import {
  npRequireAgentGuardianSourceStateCommitmentV1,
  npRequireAgentSecurityCredentialChangePayloadV1,
  npRequireAgentSecurityCredentialTransitionV1,
} from "./guardian-credential-contract.js";

const id = "73111111-1111-4111-8111-111111111111",
  receipt = "73111111-1111-4111-8111-111111111112",
  digest = `cj1:sha256:${"A".repeat(43)}`;
const commitment = (last = "A", keyId = "host-source-1") => ({
  keyId,
  mac: `hmac-sha256:${"A".repeat(42)}${last}`,
});
const password = (audience = "staff", purpose = "password-reset") => ({
  kind: "password-replaced",
  audience,
  principalId: id,
  purpose,
  previous: { tokenVersion: 0 },
  current: { tokenVersion: 1 },
  memberResetActivation: null,
});
const token = (reason = "issued") => ({
  kind: "gateway-token",
  principalId: id,
  tokenId: receipt,
  reason,
  previous: null,
  current: { rowVersion: 1, status: "active_head" },
});
const connection = () => ({
  kind: "connection-credential",
  connectionId: id,
  operation: "activated",
  previous: { credentialVersion: null, commitment: commitment() },
  current: { credentialVersion: 1, commitment: commitment("E") },
});
const payload = (transition: unknown, scope = "deployment") => ({
  kind: "security.credential.changed",
  transitionId: id,
  sourceReceiptId: receipt,
  impact: { scope, affectedSiteCount: scope === "site" ? 1 : 3, siteCatalogDigest: digest },
  transition,
});

describe("closed committed Guardian credential transitions", () => {
  it("binds principal-wide changes to actual row/token versions and keyed scope state without child-token claims", () => {
    const previous = {
      rowVersion: 2,
      tokenVersion: 1,
      status: "active",
      authorityPresent: true,
      scopeCommitment: commitment(),
    };
    const change = (reason: string, current: unknown) => ({
      kind: "gateway-principal",
      principalId: id,
      reason,
      previous,
      current,
    });
    const cases = [
      change("updated", {
        ...previous,
        rowVersion: 3,
        tokenVersion: 2,
        scopeCommitment: commitment("E"),
      }),
      change("suspended", { ...previous, rowVersion: 3, status: "suspended" }),
      change("revoked", { ...previous, rowVersion: 3, tokenVersion: 2, status: "revoked" }),
      change("authority-lost", {
        ...previous,
        rowVersion: 3,
        tokenVersion: 2,
        status: "suspended",
        authorityPresent: false,
      }),
      {
        ...change("resumed", { ...previous, rowVersion: 3 }),
        previous: { ...previous, status: "suspended" },
      },
    ];
    for (const value of cases)
      expect(
        npRequireAgentSecurityCredentialChangePayloadV1(
          JSON.parse(JSON.stringify(payload(value, "site"))) as unknown,
        ),
      ).toEqual(payload(value, "site"));
    for (const value of [
      change("updated", { ...previous, rowVersion: 3 }),
      change("updated", { ...previous, rowVersion: 3, scopeCommitment: commitment("E") }),
      change("suspended", { ...previous, rowVersion: 3, status: "suspended", tokenVersion: 2 }),
      change("authority-lost", {
        ...previous,
        rowVersion: 3,
        tokenVersion: 2,
        status: "suspended",
      }),
      change("revoked", {
        ...previous,
        rowVersion: 3,
        tokenVersion: 2,
        status: "revoked",
        scopeCommitment: commitment("E"),
      }),
      change("suspended", {
        ...previous,
        rowVersion: 3,
        status: "suspended",
        scopes: ["site:read"],
      }),
    ])
      expect(() => npRequireAgentSecurityCredentialTransitionV1(value)).toThrow();
  });
  it("preserves exact password version changes with deployment impact and no credential material", () => {
    for (const purpose of ["password-change", "password-reset", "invite-accept"]) {
      const value = payload(password("staff", purpose));
      expect(npRequireAgentSecurityCredentialChangePayloadV1(value)).toEqual(value);
    }
    for (const bad of [
      payload(password(), "site"),
      payload({ ...password(), previous: { tokenVersion: 1 } }),
      payload({ ...password(), current: { tokenVersion: 2 } }),
      payload({ ...password(), current: { tokenVersion: -1 } }),
      payload({ ...password(), current: { tokenVersion: 1.5 } }),
      payload({
        ...password(),
        previous: { tokenVersion: 2147483647 },
        current: { tokenVersion: 2147483648 },
      }),
      payload({ ...password(), password: "secret" }),
      payload({ ...password(), previous: { tokenVersion: 0, passwordHash: "argon2-private" } }),
      payload({ ...password(), purpose: "email-verify" }),
      payload({ ...password(), audience: "anonymous" }),
      { ...payload(password()), sourceReceiptId: "not-a-receipt" },
      {
        ...payload(password()),
        impact: { scope: "deployment", affectedSiteCount: 10001, siteCatalogDigest: digest },
      },
    ])
      expect(() => npRequireAgentSecurityCredentialChangePayloadV1(bad)).toThrow();
  });
  it("records member reset verification and activation as explicit independent facts without activating suspended/deleted/imported accounts", () => {
    for (const status of ["pending", "active", "suspended", "deleted", "imported"]) {
      const value = {
        ...password("member"),
        memberResetActivation: {
          previous: { emailVerified: false, status },
          current: { emailVerified: true, status: status === "pending" ? "active" : status },
        },
      };
      expect(npRequireAgentSecurityCredentialTransitionV1(value)).toEqual(value);
    }
    const alreadyActive = {
      ...password("member"),
      memberResetActivation: {
        previous: { emailVerified: true, status: "active" },
        current: { emailVerified: true, status: "active" },
      },
    };
    expect(npRequireAgentSecurityCredentialTransitionV1(alreadyActive)).toEqual(alreadyActive);
    expect(
      npRequireAgentSecurityCredentialTransitionV1(password("member", "password-change")),
    ).toEqual(password("member", "password-change"));
    for (const bad of [
      password("member"),
      password("member", "invite-accept"),
      { ...alreadyActive, audience: "staff" },
      { ...alreadyActive, purpose: "password-change" },
      {
        ...alreadyActive,
        memberResetActivation: {
          previous: { emailVerified: false, status: "suspended" },
          current: { emailVerified: true, status: "active" },
        },
      },
      {
        ...alreadyActive,
        memberResetActivation: {
          previous: { emailVerified: false, status: "pending" },
          current: { emailVerified: false, status: "active" },
        },
      },
      {
        ...alreadyActive,
        memberResetActivation: {
          previous: { emailVerified: true, status: "active" },
          current: { emailVerified: true, status: "pending" },
        },
      },
      {
        ...alreadyActive,
        memberResetActivation: { ...alreadyActive.memberResetActivation, actorUserId: id },
      },
    ])
      expect(() => npRequireAgentSecurityCredentialTransitionV1(bad)).toThrow();
  });
  it("captures actual Gateway insertion, both rotation rows and exact revocation without token/verifier bytes", () => {
    const retired = {
      ...token("rotation"),
      previous: { rowVersion: 3, status: "active_head" },
      current: { rowVersion: 4, status: "overlap" },
    };
    const revoked = {
      ...token("revoked"),
      previous: { rowVersion: 4, status: "overlap" },
      current: { rowVersion: 5, status: "revoked" },
    };
    for (const value of [
      token(),
      token("rotation"),
      retired,
      { ...retired, current: { rowVersion: 4, status: "revoked" } },
      revoked,
    ])
      expect(
        npRequireAgentSecurityCredentialChangePayloadV1(
          JSON.parse(JSON.stringify(payload(value, "site"))) as unknown,
        ),
      ).toEqual(payload(value, "site"));
    for (const bad of [
      payload(token()),
      { ...token(), token: "npst1.private" },
      { ...token(), tokenHash: digest },
      { ...token(), secretVersionId: id },
      { ...token(), reason: "revoked" },
      { ...token(), current: { rowVersion: 2, status: "active_head" } },
      { ...retired, reason: "issued" },
      { ...retired, previous: { rowVersion: 3, status: "overlap" } },
      { ...retired, current: { rowVersion: 4, status: "active_head" } },
      { ...revoked, current: { rowVersion: 4, status: "revoked" } },
    ])
      expect(() => npRequireAgentSecurityCredentialTransitionV1(bad)).toThrow();
  });
  it("binds Connection activation/revocation to advancing versions and same-key state commitments, never a secret locator", () => {
    const changed = connection(),
      rotated = {
        ...changed,
        previous: { credentialVersion: 1, commitment: commitment() },
        current: { credentialVersion: 3, commitment: commitment("E") },
      },
      revoked = {
        ...changed,
        operation: "revoked",
        previous: { credentialVersion: 3, commitment: commitment() },
        current: { credentialVersion: null, commitment: commitment("E") },
      };
    for (const value of [changed, rotated, revoked])
      expect(
        npRequireAgentSecurityCredentialChangePayloadV1(
          JSON.parse(JSON.stringify(payload(value, "site"))) as unknown,
        ),
      ).toEqual(payload(value, "site"));
    for (const bad of [
      { ...changed, secretRef: "vault://private" },
      { ...changed, current: { ...changed.current, secretVersionId: id } },
      { ...changed, current: { ...changed.current, commitment: commitment() } },
      { ...changed, current: { ...changed.current, commitment: commitment("E", "rotated-key") } },
      { ...rotated, current: { ...rotated.current, credentialVersion: 1 } },
      { ...revoked, current: { ...revoked.current, credentialVersion: 4 } },
      { ...revoked, previous: { ...revoked.previous, credentialVersion: null } },
      { ...changed, operation: "sealed" },
    ])
      expect(() => npRequireAgentSecurityCredentialTransitionV1(bad)).toThrow();
    expect(() => npRequireAgentSecurityCredentialChangePayloadV1(payload(changed))).toThrow();
  });
  it("validates keyed commitment shape without pretending to verify authenticity", () => {
    expect(npRequireAgentGuardianSourceStateCommitmentV1(commitment())).toEqual(commitment());
    for (const bad of [
      { keyId: "host", mac: digest },
      { keyId: "host", mac: "a".repeat(64) },
      { keyId: "host", mac: `hmac-sha256:${"A".repeat(42)}B` },
      commitment("A", "../key"),
      { ...commitment(), key: "secret" },
    ])
      expect(() => npRequireAgentGuardianSourceStateCommitmentV1(bad)).toThrow();
  });
  it("rejects hostile objects, accessors, cycles and extras without invoking getters or leaking their contents", () => {
    const getter = vi.fn(() => "private-credential-marker"),
      hostile = { ...password() };
    Object.defineProperty(hostile, "password", { enumerable: true, get: getter });
    expect(() => npRequireAgentSecurityCredentialTransitionV1(hostile)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const cycle: Record<string, unknown> = { ...password() };
    cycle.current = cycle;
    expect(() => npRequireAgentSecurityCredentialTransitionV1(cycle)).toThrow();
    expect(() =>
      npRequireAgentSecurityCredentialTransitionV1(
        Object.assign(Object.create({ password: "inherited" }), password()),
      ),
    ).toThrow();
    const input = password(),
      result = npRequireAgentSecurityCredentialTransitionV1(input);
    input.current.tokenVersion = 9;
    expect(result.current).toEqual({ tokenVersion: 1 });
  });
});
