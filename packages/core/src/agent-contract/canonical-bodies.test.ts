import { describe, expect, it } from "vitest";

import {
  npAgentEffectProfileCanonicalExcludedKeysV1,
  npAgentEffectProfileCanonicalIncludedKeysV1,
  npAgentRunLimitsCanonicalExcludedKeysV1,
  npAgentRunLimitsCanonicalIncludedKeysV1,
  npAgentStaffSiteAuthorizationCanonicalExcludedKeysV1,
  npAgentStaffSiteAuthorizationCanonicalIncludedKeysV1,
  npAgentStaffSiteAuthorizationCanonicalSiteRoleIncludedKeysV1,
  npAgentStaffSiteAuthorizationCanonicalSuperAdminIncludedKeysV1,
  npAgentVaultAadCanonicalExcludedKeysV1,
  npAgentVaultAadCanonicalIncludedKeysV1,
  npAnalyzeAgentEffectProfileCanonical,
  npAnalyzeAgentRunLimitsCanonical,
  npAnalyzeAgentStaffSiteAuthorizationCanonical,
  npAnalyzeAgentVaultAadCanonical,
  npBuildAgentEffectProfileCanonicalBytes,
  npBuildAgentRunLimitsCanonicalBytes,
  npBuildAgentStaffSiteAuthorizationCanonicalBytes,
  npBuildAgentVaultAadCanonicalBytes,
  npDigestAgentEffectProfileCanonical,
  npDigestAgentRunLimitsCanonical,
  npDigestAgentStaffSiteAuthorizationCanonical,
  npDigestAgentVaultAadCanonical,
  npRequireAgentEffectProfileCanonical,
  npRequireAgentRunLimitsCanonical,
  npRequireAgentStaffSiteAuthorizationCanonical,
  npRequireAgentVaultAadCanonical,
} from "./index.js";

const decoder = new TextDecoder();

const effectProfile = {
  schemaVersion: "np.agent-effect-profile.v1",
  capabilityId: "changeset.apply",
  capabilityContractVersion: 1,
  implementationVersion: 3,
  profileId: "apply",
  kind: "mutation",
  reversibility: "compensatable",
  minimumGatewayExposure: "approved-execute",
  effectContractVersion: 2,
  verifierId: "changeset.verify",
  compensatorId: "changeset.rollback",
} as const;

const runLimits = {
  schemaVersion: "np.agent-run-limits.v1",
  maxAttempts: 3,
  maxProviderCalls: 5,
  maxCapabilityCalls: 8,
  maxInputTokens: 20_000,
  maxOutputTokens: 4_000,
  maxCostMicros: 2_500_000,
  maxWallClockSeconds: 900,
} as const;

const staffSiteAuthorization = {
  schemaVersion: "np.agent-staff-site-authorization.v1",
  siteId: "docs-site",
  userId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  userTokenVersion: 7,
  authority: {
    kind: "site-role",
    source: "membership",
    role: "editor",
    capabilities: ["admin.manage", "site.access"],
  },
} as const;

const vaultAad = {
  schemaVersion: "np.agent-vault-aad.v1",
  siteId: "docs-site",
  connectionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
  connectionKind: "model",
  purpose: "connection-credential",
  secretVersionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
  secretVersion: 4,
  vaultAdapterId: "local-envelope",
  vaultAdapterContractVersion: 1,
  vaultAdapterFingerprint: "sha256:local-envelope-v1",
  credentialEnvelopeVersion: 1,
  algorithm: "AES-256-GCM",
} as const;

describe("Agent exact canonical leaf bodies", () => {
  it("publishes the literal included, excluded, and branch field fixtures", () => {
    expect(npAgentEffectProfileCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "capabilityId",
      "capabilityContractVersion",
      "implementationVersion",
      "profileId",
      "kind",
      "reversibility",
      "minimumGatewayExposure",
      "effectContractVersion",
      "verifierId",
      "compensatorId",
    ]);
    expect(npAgentEffectProfileCanonicalExcludedKeysV1).toEqual([
      "effectFingerprint",
      "capabilityFingerprint",
      "registeredAt",
      "sourceFunction",
      "verify",
      "deriveUndo",
      "compensate",
    ]);
    expect(npAgentRunLimitsCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "maxAttempts",
      "maxProviderCalls",
      "maxCapabilityCalls",
      "maxInputTokens",
      "maxOutputTokens",
      "maxCostMicros",
      "maxWallClockSeconds",
    ]);
    expect(npAgentRunLimitsCanonicalExcludedKeysV1).toEqual([
      "limitsHash",
      "runLimitsHash",
      "resolvedAt",
      "sourceRefs",
    ]);
    expect(npAgentStaffSiteAuthorizationCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "userId",
      "userTokenVersion",
      "authority",
    ]);
    expect(npAgentStaffSiteAuthorizationCanonicalExcludedKeysV1).toEqual([
      "siteAuthorizationDigest",
      "sessionId",
      "sessionFingerprint",
      "issuedAt",
      "expiresAt",
      "viewerToken",
    ]);
    expect(npAgentStaffSiteAuthorizationCanonicalSuperAdminIncludedKeysV1).toEqual([
      "kind",
      "capabilities",
    ]);
    expect(npAgentStaffSiteAuthorizationCanonicalSiteRoleIncludedKeysV1).toEqual([
      "kind",
      "source",
      "role",
      "capabilities",
    ]);
    expect(npAgentVaultAadCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "connectionId",
      "connectionKind",
      "purpose",
      "secretVersionId",
      "secretVersion",
      "vaultAdapterId",
      "vaultAdapterContractVersion",
      "vaultAdapterFingerprint",
      "credentialEnvelopeVersion",
      "algorithm",
    ]);
    expect(npAgentVaultAadCanonicalExcludedKeysV1).toEqual([
      "aadDigest",
      "nonce",
      "ciphertext",
      "authenticationTag",
      "wrappedDek",
      "keyId",
      "keyVersion",
      "secretRef",
      "idempotencyKey",
      "requestDigest",
      "resultDigest",
      "adapterReceipt",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("normalizes exact bodies without returning caller-owned objects", () => {
    const effect = npRequireAgentEffectProfileCanonical(effectProfile);
    const limits = npRequireAgentRunLimitsCanonical(runLimits);
    const authorization = npRequireAgentStaffSiteAuthorizationCanonical(staffSiteAuthorization);
    const aad = npRequireAgentVaultAadCanonical(vaultAad);

    expect(effect).toEqual(effectProfile);
    expect(limits).toEqual(runLimits);
    expect(authorization).toEqual(staffSiteAuthorization);
    expect(aad).toEqual(vaultAad);
    expect(effect).not.toBe(effectProfile);
    expect(limits).not.toBe(runLimits);
    expect(authorization).not.toBe(staffSiteAuthorization);
    expect(authorization.authority).not.toBe(staffSiteAuthorization.authority);
    expect(authorization.authority.capabilities).not.toBe(
      staffSiteAuthorization.authority.capabilities,
    );
    expect(aad).not.toBe(vaultAad);
  });

  it("enforces exact effect-profile semantics", () => {
    expect(
      npAnalyzeAgentEffectProfileCanonical({
        ...effectProfile,
        kind: "read",
        reversibility: "none",
        minimumGatewayExposure: "read",
        verifierId: null,
        compensatorId: null,
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentEffectProfileCanonical({
        ...effectProfile,
        kind: "read",
        reversibility: "none",
        verifierId: "changeset.verify",
        compensatorId: null,
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentEffectProfileCanonical({
        ...effectProfile,
        minimumGatewayExposure: "read",
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentEffectProfileCanonical({
        ...effectProfile,
        reversibility: "none",
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentEffectProfileCanonical({ ...effectProfile, effectFingerprint: "forbidden" }).ok,
    ).toBe(false);
  });

  it("enforces concrete run-limit integer bounds", () => {
    expect(npAnalyzeAgentRunLimitsCanonical({ ...runLimits, maxAttempts: 0 }).ok).toBe(false);
    expect(
      npAnalyzeAgentRunLimitsCanonical({ ...runLimits, maxProviderCalls: 2_147_483_648 }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentRunLimitsCanonical({ ...runLimits, maxCostMicros: Number.MAX_SAFE_INTEGER }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentRunLimitsCanonical({
        ...runLimits,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        maxCostMicros: 0,
      }).ok,
    ).toBe(true);
    expect(npAnalyzeAgentRunLimitsCanonical({ ...runLimits, maxWallClockSeconds: 86_401 }).ok).toBe(
      false,
    );
    expect(npAnalyzeAgentRunLimitsCanonical({ ...runLimits, resolvedAt: "forbidden" }).ok).toBe(
      false,
    );
  });

  it("enforces sorted capabilities and exact staff authority branches", () => {
    expect(
      npAnalyzeAgentStaffSiteAuthorizationCanonical({
        ...staffSiteAuthorization,
        authority: { kind: "super-admin", capabilities: ["admin.manage", "site.access"] },
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentStaffSiteAuthorizationCanonical({
        ...staffSiteAuthorization,
        authority: {
          ...staffSiteAuthorization.authority,
          capabilities: ["site.access", "admin.manage"],
        },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentStaffSiteAuthorizationCanonical({
        ...staffSiteAuthorization,
        authority: {
          kind: "super-admin",
          role: "admin",
          capabilities: ["admin.manage"],
        },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentStaffSiteAuthorizationCanonical({
        ...staffSiteAuthorization,
        userId: "NOT-A-UUID",
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentStaffSiteAuthorizationCanonical({
        ...staffSiteAuthorization,
        authority: { ...staffSiteAuthorization.authority, role: "owner" },
      }).ok,
    ).toBe(false);
  });

  it("enforces the exact vault AAD identity and algorithm grammar", () => {
    expect(npAnalyzeAgentVaultAadCanonical({ ...vaultAad, algorithm: "custom:kms.v2" }).ok).toBe(
      true,
    );
    expect(npAnalyzeAgentVaultAadCanonical({ ...vaultAad, algorithm: "custom:KMS" }).ok).toBe(
      false,
    );
    expect(npAnalyzeAgentVaultAadCanonical({ ...vaultAad, secretVersion: 0 }).ok).toBe(false);
    expect(
      npAnalyzeAgentVaultAadCanonical({
        ...vaultAad,
        vaultAdapterFingerprint: "unsafe\nvalue",
      }).ok,
    ).toBe(false);
    expect(npAnalyzeAgentVaultAadCanonical({ ...vaultAad, aadDigest: "forbidden" }).ok).toBe(false);
  });

  it("never executes accessors or Proxy get traps", () => {
    let reads = 0;
    const accessor = { ...runLimits } as Record<string, unknown>;
    Object.defineProperty(accessor, "maxAttempts", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("secret accessor");
      },
    });
    expect(npAnalyzeAgentRunLimitsCanonical(accessor).ok).toBe(false);
    expect(reads).toBe(0);

    const proxy = new Proxy(vaultAad, {
      get() {
        reads += 1;
        throw new Error("secret get trap");
      },
    });
    expect(npAnalyzeAgentVaultAadCanonical(proxy).ok).toBe(true);
    expect(reads).toBe(0);
  });

  it("emits independent canonical-byte and SHA-256 golden vectors", async () => {
    const vectors = [
      {
        bytes: npBuildAgentEffectProfileCanonicalBytes(effectProfile),
        json: '{"capabilityContractVersion":1,"capabilityId":"changeset.apply","compensatorId":"changeset.rollback","effectContractVersion":2,"implementationVersion":3,"kind":"mutation","minimumGatewayExposure":"approved-execute","profileId":"apply","reversibility":"compensatable","schemaVersion":"np.agent-effect-profile.v1","verifierId":"changeset.verify"}',
        digest: await npDigestAgentEffectProfileCanonical(effectProfile),
        expectedDigest: "cj1:sha256:T21-Vl0kaDoz0ekrnmbocvF2d4RZbcwdB_WIPR8HXBk",
      },
      {
        bytes: npBuildAgentRunLimitsCanonicalBytes(runLimits),
        json: '{"maxAttempts":3,"maxCapabilityCalls":8,"maxCostMicros":2500000,"maxInputTokens":20000,"maxOutputTokens":4000,"maxProviderCalls":5,"maxWallClockSeconds":900,"schemaVersion":"np.agent-run-limits.v1"}',
        digest: await npDigestAgentRunLimitsCanonical(runLimits),
        expectedDigest: "cj1:sha256:Nmsm86_pWg0eajtQDgFXhMSmJLUkr9rysW2BexPsQx8",
      },
      {
        bytes: npBuildAgentStaffSiteAuthorizationCanonicalBytes(staffSiteAuthorization),
        json: '{"authority":{"capabilities":["admin.manage","site.access"],"kind":"site-role","role":"editor","source":"membership"},"schemaVersion":"np.agent-staff-site-authorization.v1","siteId":"docs-site","userId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd1","userTokenVersion":7}',
        digest: await npDigestAgentStaffSiteAuthorizationCanonical(staffSiteAuthorization),
        expectedDigest: "cj1:sha256:vYfQk83RNi-TVzHbdfwd-UbSoeJEj8pwk0iDT2qZC4c",
      },
      {
        bytes: npBuildAgentVaultAadCanonicalBytes(vaultAad),
        json: '{"algorithm":"AES-256-GCM","connectionId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd2","connectionKind":"model","credentialEnvelopeVersion":1,"purpose":"connection-credential","schemaVersion":"np.agent-vault-aad.v1","secretVersion":4,"secretVersionId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd3","siteId":"docs-site","vaultAdapterContractVersion":1,"vaultAdapterFingerprint":"sha256:local-envelope-v1","vaultAdapterId":"local-envelope"}',
        digest: await npDigestAgentVaultAadCanonical(vaultAad),
        expectedDigest: "cj1:sha256:w5BYvH9zhlTceRuBqH3UeIpkLsd3e1-1bkmEaydrFS0",
      },
    ];

    vectors.forEach(({ bytes, json, digest, expectedDigest }) => {
      expect(decoder.decode(bytes.canonicalJsonUtf8)).toBe(json);
      expect(decoder.decode(bytes.domainSeparatedUtf8)).toBe(
        `np.agent-canonical-json.v1\0${bytes.purpose}\0${json}`,
      );
      expect(digest).toBe(expectedDigest);
    });
  });
});
