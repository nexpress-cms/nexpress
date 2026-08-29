import { describe, expect, it } from "vitest";

import {
  npBuildAgentVaultOperationRequestDigestBytesV1,
  npDigestAgentVaultOperationRequestV1,
  npVerifyAgentVaultOperationRequestDigestV1,
} from "./index.js";

const aad = {
  schemaVersion: "np.agent-vault-aad.v1" as const,
  siteId: "docs-site",
  connectionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
  connectionKind: "model" as const,
  purpose: "connection-credential" as const,
  secretVersionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
  secretVersion: 4,
  vaultAdapterId: "local-envelope",
  vaultAdapterContractVersion: 1,
  vaultAdapterFingerprint: "sha256:local-envelope-v1",
  credentialEnvelopeVersion: 1 as const,
  algorithm: "AES-256-GCM" as const,
};

const input = {
  siteId: aad.siteId,
  kind: "seal" as const,
  adapterId: aad.vaultAdapterId,
  adapterContractVersion: aad.vaultAdapterContractVersion,
  adapterFingerprint: aad.vaultAdapterFingerprint,
  secretVersionId: aad.secretVersionId,
  idempotencyKey: `seal:${aad.secretVersionId}:4`,
  aad,
  operationInput: {
    kind: "seal" as const,
    plaintextEnvelope: Buffer.from("a6000101000261780301046166054100", "hex"),
  },
};

describe("Agent vault operation request digest", () => {
  it("freezes the u32-framed HMAC vector", () => {
    const key = { id: "vault-request-test-1", key: Uint8Array.from({ length: 32 }, (_, i) => i) };
    const bytes = npBuildAgentVaultOperationRequestDigestBytesV1(input);
    expect(Buffer.from(bytes).toString("hex")).toMatchSnapshot();
    const digest = npDigestAgentVaultOperationRequestV1(input, key);
    expect(digest).toBe(
      "cj1:hmac-sha256:vault-request-test-1:e4WfYI6AKH12JSflYxC1FW3-8cPKnY_w-nZ5OLTLG5s",
    );
    expect(
      npVerifyAgentVaultOperationRequestDigestV1(digest, input, {
        active: key,
      }),
    ).toBe(true);
  });

  it("binds plaintext, AAD, adapter, identity, and idempotency metadata", () => {
    const key = { id: "vault-request-test-1", key: new Uint8Array(32).fill(7) };
    const digest = npDigestAgentVaultOperationRequestV1(input, key);
    const mutations = [
      { ...input, siteId: "other-site", aad: { ...aad, siteId: "other-site" } },
      { ...input, idempotencyKey: `${input.idempotencyKey}:changed` },
      {
        ...input,
        operationInput: { kind: "seal" as const, plaintextEnvelope: Uint8Array.of(1) },
      },
    ];
    for (const mutation of mutations) {
      expect(npVerifyAgentVaultOperationRequestDigestV1(digest, mutation, { active: key })).toBe(
        false,
      );
    }
  });

  it("rejects unbounded or non-canonical operation metadata", () => {
    expect(() =>
      npBuildAgentVaultOperationRequestDigestBytesV1({
        ...input,
        idempotencyKey: "contains space",
      }),
    ).toThrowError(/idempotency key/u);
    expect(() =>
      npBuildAgentVaultOperationRequestDigestBytesV1({
        ...input,
        kind: "destroy",
        operationInput: { kind: "destroy", secretRef: "line\nbreak" },
      }),
    ).toThrowError(/secret locator/u);
    expect(() =>
      npBuildAgentVaultOperationRequestDigestBytesV1({
        ...input,
        kind: "rewrap",
        operationInput: {
          kind: "rewrap",
          secretRef: "vault:secret",
          targetKeyId: "UPPERCASE",
          targetKeyVersion: "v2",
        },
      }),
    ).toThrowError(/target key/u);
  });
});
