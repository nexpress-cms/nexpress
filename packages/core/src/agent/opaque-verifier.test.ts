import { describe, expect, it } from "vitest";

import {
  npMintAgentOpaqueVerifierV1,
  npParseAgentOpaqueVerifierV1,
  npVerifyAgentOpaqueVerifierV1,
  type NpAgentTokenHashKeyring,
} from "./opaque-verifier.js";

const TOKEN_ID = "11111111-1111-4111-8111-111111111111";
const keyring: NpAgentTokenHashKeyring = {
  active: { id: "agent-token-hash-v1", key: new Uint8Array(32).fill(7) },
};

describe("Agent opaque verifier v1", () => {
  it("mints the exact service-token grammar and verifies only its bound context", () => {
    const minted = npMintAgentOpaqueVerifierV1({
      purpose: "service-token",
      siteId: "docs-site",
      publicId: TOKEN_ID,
      keyring,
    });
    expect(minted.value).toMatch(/^npst1_11111111-1111-4111-8111-111111111111_[A-Za-z0-9_-]{43}$/u);
    expect(minted.prefix).toBe(`npst1_${TOKEN_ID}`);
    expect(minted.verifier).toMatch(/^ov1:hmac-sha256:agent-token-hash-v1:[A-Za-z0-9_-]{43}$/u);
    const parsed = npParseAgentOpaqueVerifierV1("service-token", minted.value);
    expect(parsed?.publicId).toBe(TOKEN_ID);
    expect(parsed?.secret).toHaveLength(32);
    expect(
      npVerifyAgentOpaqueVerifierV1({
        purpose: "service-token",
        siteId: "docs-site",
        publicId: TOKEN_ID,
        secret: parsed!.secret,
        storedVerifier: minted.verifier,
        storedHashKeyId: minted.hashKeyId,
        keyring,
      }),
    ).toBe(true);
    expect(
      npVerifyAgentOpaqueVerifierV1({
        purpose: "service-token",
        siteId: "other-site",
        publicId: TOKEN_ID,
        secret: parsed!.secret,
        storedVerifier: minted.verifier,
        storedHashKeyId: minted.hashKeyId,
        keyring,
      }),
    ).toBe(false);
  });

  it("fails closed on wrong purposes, padded secrets, unknown keys, and verifier disagreement", () => {
    const minted = npMintAgentOpaqueVerifierV1({
      purpose: "service-token",
      siteId: "docs-site",
      publicId: TOKEN_ID,
      keyring,
    });
    expect(npParseAgentOpaqueVerifierV1("authorization-code", minted.value)).toBeNull();
    expect(npParseAgentOpaqueVerifierV1("service-token", `${minted.value}=`)).toBeNull();
    const parsed = npParseAgentOpaqueVerifierV1("service-token", minted.value)!;
    expect(
      npVerifyAgentOpaqueVerifierV1({
        purpose: "service-token",
        siteId: "docs-site",
        publicId: TOKEN_ID,
        secret: parsed.secret,
        storedVerifier: minted.verifier,
        storedHashKeyId: "retired-key",
        keyring,
      }),
    ).toBe(false);
    expect(
      npVerifyAgentOpaqueVerifierV1({
        purpose: "service-token",
        siteId: "docs-site",
        publicId: TOKEN_ID,
        secret: new Uint8Array(32),
        storedVerifier: minted.verifier,
        storedHashKeyId: minted.hashKeyId,
        keyring,
      }),
    ).toBe(false);
  });
});
