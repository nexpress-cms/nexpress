import { describe, expect, it } from "vitest";

import {
  NpAgentVaultError,
  npDecodeAgentVaultPlaintextEnvelopeV1,
  npEncodeAgentVaultPlaintextEnvelopeV1,
  npZeroAgentVaultEnvelopeV1,
} from "./index.js";

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

describe("Agent vault deterministic-CBOR codec", () => {
  it("reproduces the two normative lowercase-hex vectors", () => {
    expect(
      hex(
        npEncodeAgentVaultPlaintextEnvelopeV1({
          schemaVersion: "np.agent-credential-envelope.v1",
          kind: "api_key",
          adapterId: "x",
          adapterContractVersion: 1,
          adapterFingerprint: "f",
          secret: Uint8Array.of(0),
        }),
      ),
    ).toBe("a6000101000261780301046166054100");
    expect(
      hex(
        npEncodeAgentVaultPlaintextEnvelopeV1({
          schemaVersion: "np.agent-credential-envelope.v1",
          kind: "provider_oauth_code",
          code: Uint8Array.of(0x41),
        }),
      ),
    ).toBe("a3000101030e4141");
  });

  it("round-trips every exact branch byte-for-byte", () => {
    const values = [
      {
        schemaVersion: "np.agent-credential-envelope.v1" as const,
        kind: "api_key" as const,
        adapterId: "fake-provider",
        adapterContractVersion: 3,
        adapterFingerprint: "sha256:fake-provider-v3",
        secret: new TextEncoder().encode("secret-value"),
      },
      {
        schemaVersion: "np.agent-credential-envelope.v1" as const,
        kind: "oauth" as const,
        adapterId: "fake-provider",
        adapterContractVersion: 3,
        adapterFingerprint: "sha256:fake-provider-v3",
        tokenType: "Bearer" as const,
        accessToken: new TextEncoder().encode("access"),
        accessExpiresAt: "2026-08-29T00:00:00.000Z",
        refresh: {
          mode: "present" as const,
          token: new TextEncoder().encode("refresh"),
          expiresAt: null,
        },
        grantedPermissions: ["models.read", "responses.write"],
      },
      {
        schemaVersion: "np.agent-credential-envelope.v1" as const,
        kind: "oauth" as const,
        adapterId: "fake-provider",
        adapterContractVersion: 3,
        adapterFingerprint: "sha256:fake-provider-v3",
        tokenType: "Bearer" as const,
        accessToken: new TextEncoder().encode("access"),
        accessExpiresAt: "2026-08-29T00:00:00.000Z",
        refresh: { mode: "absent" as const },
        grantedPermissions: [],
      },
      {
        schemaVersion: "np.agent-credential-envelope.v1" as const,
        kind: "provider_oauth_pkce" as const,
        verifier: new TextEncoder().encode("A".repeat(43)),
      },
      {
        schemaVersion: "np.agent-credential-envelope.v1" as const,
        kind: "provider_oauth_pkce" as const,
        verifier: new TextEncoder().encode("z".repeat(128)),
      },
      {
        schemaVersion: "np.agent-credential-envelope.v1" as const,
        kind: "provider_oauth_code" as const,
        code: Uint8Array.of(0, 1, 2, 255),
      },
    ];

    for (const value of values) {
      const encoded = npEncodeAgentVaultPlaintextEnvelopeV1(value);
      const decoded = npDecodeAgentVaultPlaintextEnvelopeV1(encoded);
      const reencoded = npEncodeAgentVaultPlaintextEnvelopeV1(decoded);
      expect(reencoded).toEqual(encoded);
      npZeroAgentVaultEnvelopeV1(decoded);
      encoded.fill(0);
      reencoded.fill(0);
    }
  });

  it("does not mutate caller-owned secret buffers during encoding", () => {
    const secret = Uint8Array.of(1, 2, 3);
    const encoded = npEncodeAgentVaultPlaintextEnvelopeV1({
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "api_key",
      adapterId: "fake",
      adapterContractVersion: 1,
      adapterFingerprint: "sha256:fake-v1",
      secret,
    });
    expect(secret).toEqual(Uint8Array.of(1, 2, 3));
    encoded.fill(0);
  });

  it("rejects non-canonical, cross-branch, malformed, and oversized bytes", () => {
    const hostile = [
      // Indefinite map.
      Uint8Array.of(0xbf, 0xff),
      // Non-shortest version integer.
      Buffer.from("a300180101030e4141", "hex"),
      // Unsorted map keys.
      Buffer.from("a3010300010e4141", "hex"),
      // Duplicate key.
      Buffer.from("a40001010301030e4141", "hex"),
      // Extra API-key branch key 14.
      Buffer.from("a70001010002617803010461660541000e4141", "hex"),
      // Tag.
      Uint8Array.of(0xc0, 0xa0),
      // Float.
      Uint8Array.of(0xfb, 0, 0, 0, 0, 0, 0, 0, 0),
      new Uint8Array(160 * 1_024 + 1),
    ];
    for (const value of hostile) {
      expect(() => npDecodeAgentVaultPlaintextEnvelopeV1(value)).toThrow(NpAgentVaultError);
    }
  });

  it("requires sorted permissions and the exact PKCE grammar", () => {
    const oauth = {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "oauth",
      adapterId: "fake",
      adapterContractVersion: 1,
      adapterFingerprint: "sha256:fake-v1",
      tokenType: "Bearer",
      accessToken: Uint8Array.of(1),
      accessExpiresAt: "2026-08-29T00:00:00.000Z",
      refresh: { mode: "absent" },
    } as const;
    for (const grantedPermissions of [["write", "read"], ["bad\ud800value"]]) {
      expect(() =>
        npEncodeAgentVaultPlaintextEnvelopeV1({
          ...oauth,
          grantedPermissions,
        }),
      ).toThrow(NpAgentVaultError);
    }
    expect(() =>
      npEncodeAgentVaultPlaintextEnvelopeV1({
        ...oauth,
        accessToken: new Uint8Array(160 * 1_024 + 1),
        grantedPermissions: [],
      }),
    ).toThrow(NpAgentVaultError);
    for (const verifier of ["A".repeat(42), "A".repeat(129), "!".repeat(43)]) {
      expect(() =>
        npEncodeAgentVaultPlaintextEnvelopeV1({
          schemaVersion: "np.agent-credential-envelope.v1",
          kind: "provider_oauth_pkce",
          verifier: new TextEncoder().encode(verifier),
        }),
      ).toThrow(NpAgentVaultError);
    }
  });
});
