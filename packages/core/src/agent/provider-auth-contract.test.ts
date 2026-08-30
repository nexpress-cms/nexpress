import { describe, expect, it } from "vitest";

import type { NpAgentJsonSchema } from "../agent-contract/index.js";

import {
  NpAgentConnectionAuthAdapterRegistryV1,
  npBuildAgentAccountSubjectDigestBytesV1,
  npParseAgentProviderConnectionConfigV1,
  npProjectAgentAccountSubjectV1,
  npProjectAgentConnectionDestinationV1,
  npRequireAgentProviderAuthorizationUrlV1,
  npRequireAgentProviderProbeResultV1,
  npRequireAgentProviderSchemaValueV1,
  npZeroAgentProviderAuthResultV1,
  npZeroAgentProviderProbeResultV1,
} from "./provider-auth-contract.js";
import { createAgentFakeProviderAdapterV1 } from "./provider-fake.js";

const connectionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";

describe("Agent provider authentication contract", () => {
  it("registers one frozen adapter identity and rejects identity drift", () => {
    const adapter = createAgentFakeProviderAdapterV1();
    const registry = new NpAgentConnectionAuthAdapterRegistryV1().register(adapter);
    const registered = registry.resolve({
      id: adapter.id,
      contractVersion: adapter.contractVersion,
      fingerprint: adapter.fingerprint,
    });
    expect(registered).toMatchObject({
      id: adapter.id,
      contractVersion: adapter.contractVersion,
      fingerprint: adapter.fingerprint,
    });
    expect(registered).not.toBe(adapter);
    expect(Object.isFrozen(registered.configSchema)).toBe(true);
    expect(registry.register(adapter)).toBe(registry);
    expect(() =>
      registry.register({
        ...adapter,
        fingerprint: `cj1:sha256:${"B".repeat(43)}`,
      }),
    ).toThrowError(expect.objectContaining({ code: "PROVIDER_ADAPTER_CONFLICT" }));
    expect(() =>
      registry.resolve({
        id: adapter.id,
        contractVersion: adapter.contractVersion,
        fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      }),
    ).toThrowError(expect.objectContaining({ code: "PROVIDER_ADAPTER_UNAVAILABLE" }));
  });

  it("host-validates parsed config and reproduces config/pricing fingerprints", async () => {
    const adapter = createAgentFakeProviderAdapterV1();
    const parsed = await npParseAgentProviderConnectionConfigV1({
      adapter,
      siteId: "docs-site",
      connectionId,
      kind: "model",
      provider: "fake-provider",
      authKind: "api_key",
      configVersion: 1,
      config: {
        accountId: "account-1",
        connectionKind: "model",
        destination: null,
        modelId: "fake-model",
      },
      dataProcessingCeiling: "public-only",
    });
    expect(parsed).toMatchObject({
      adapterId: adapter.id,
      adapterFingerprint: adapter.fingerprint,
      configVersion: 1,
      configHash: expect.stringMatching(/^cj1:sha256:[A-Za-z0-9_-]{43}$/u),
      pricingCatalogFingerprint: expect.stringMatching(/^pc1:sha256:[A-Za-z0-9_-]{43}$/u),
    });
    expect(parsed.pricingCatalog).toHaveLength(1);
    await expect(
      npParseAgentProviderConnectionConfigV1({
        adapter,
        siteId: "docs-site",
        connectionId,
        kind: "model",
        provider: "fake-provider",
        authKind: "api_key",
        configVersion: 1,
        config: {
          accountId: "account-1",
          connectionKind: "model",
          destination: null,
          modelId: "fake-model",
          accessToken: "must-not-enter-config",
        },
        dataProcessingCeiling: "public-only",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_SECRET_FORBIDDEN" });
  });

  it("freezes the account-subject u32 framing and site-separated HMAC", () => {
    const providerSubject = new TextEncoder().encode("provider-account-123");
    expect(
      Buffer.from(
        npBuildAgentAccountSubjectDigestBytesV1({
          siteId: "docs-site",
          adapterId: "fake-provider",
          providerSubject,
        }),
      ).toString("hex"),
    ).toBe(
      "0000001b6e702d6167656e742d6163636f756e742d7375626a6563742f763100000009646f63732d736974650000000d66616b652d70726f76696465720000001470726f76696465722d6163636f756e742d313233",
    );
    const key = {
      owner: "connection-account-subject" as const,
      id: "account-subject-v1",
      bytes: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    };
    const first = npProjectAgentAccountSubjectV1(
      { siteId: "docs-site", adapterId: "fake-provider", providerSubject },
      key,
    );
    const second = npProjectAgentAccountSubjectV1(
      { siteId: "other-site", adapterId: "fake-provider", providerSubject },
      key,
    );
    expect(first).toEqual({
      keyId: "account-subject-v1",
      digest: "ktopw4Dvq-DjBiIdC2nWG_R9as14IAc9ychCuY5nuXo",
    });
    expect(second.digest).not.toBe(first.digest);
  });

  it("derives and HMACs a notification destination without exposing the subject", async () => {
    const adapter = createAgentFakeProviderAdapterV1();
    const parsed = await npParseAgentProviderConnectionConfigV1({
      adapter,
      siteId: "docs-site",
      connectionId,
      kind: "notification",
      provider: "fake-provider",
      authKind: "oauth",
      configVersion: 2,
      config: {
        accountId: "account-1",
        connectionKind: "notification",
        destination: "alerts",
        modelId: null,
      },
      dataProcessingCeiling: "internal-redacted",
    });
    const projected = await npProjectAgentConnectionDestinationV1({
      adapter,
      siteId: "docs-site",
      connectionKind: "notification",
      parsedConfig: parsed,
      accountSubjectKeyId: "account-subject-v1",
      accountSubjectDigest: "a".repeat(43),
      destinationKey: {
        owner: "connection-destination",
        id: "destination-v1",
        bytes: Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
      },
    });
    expect(projected).toMatchObject({
      keyId: "destination-v1",
      descriptor: { descriptor: { channel: "alerts" } },
      fingerprint: expect.stringMatching(/^cj1:hmac-sha256:destination-v1:[A-Za-z0-9_-]{43}$/u),
    });
    expect(JSON.stringify(projected)).not.toContain("account-1");
  });

  it("accepts only declared HTTPS authorization origins and closed safe probe results", () => {
    const adapter = createAgentFakeProviderAdapterV1();
    expect(
      npRequireAgentProviderAuthorizationUrlV1(
        {
          schemaVersion: "np.agent-provider-oauth-authorize-result.v1",
          authorizationUrl: "https://provider.example/oauth/authorize?state=opaque",
        },
        adapter.oauth!.authorizationOrigins,
      ).authorizationUrl,
    ).toContain("state=opaque");
    expect(() =>
      npRequireAgentProviderAuthorizationUrlV1(
        {
          schemaVersion: "np.agent-provider-oauth-authorize-result.v1",
          authorizationUrl: "https://attacker.example/oauth/authorize",
        },
        adapter.oauth!.authorizationOrigins,
      ),
    ).toThrowError(expect.objectContaining({ code: "PROVIDER_AUTHORIZATION_URL_INVALID" }));
    expect(() =>
      npRequireAgentProviderProbeResultV1(
        {
          schemaVersion: "np.agent-provider-probe-result.v1",
          status: "ready",
          providerSubject: new Uint8Array([1]),
          grantedPermissions: [],
          capabilityIds: ["notification.send"],
          safeCode: null,
          resultDigest: "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          accessToken: "forbidden",
        },
        adapter,
      ),
    ).toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_INVALID" }));
  });

  it("resolves local schema references and rejects unsupported adapter schema keywords", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      $defs: { shortName: { type: "string", maxLength: 4 } },
      properties: { name: { $ref: "#/$defs/shortName" } },
      required: ["name"],
    } as NpAgentJsonSchema;
    expect(() => npRequireAgentProviderSchemaValueV1(schema, { name: "safe" })).not.toThrow();
    expect(() => npRequireAgentProviderSchemaValueV1(schema, { name: "too-long" })).toThrowError(
      expect.objectContaining({ code: "PROVIDER_CONFIG_SCHEMA_MISMATCH" }),
    );

    const adapter = createAgentFakeProviderAdapterV1();
    expect(() =>
      new NpAgentConnectionAuthAdapterRegistryV1().register({
        ...adapter,
        configSchema: { ...adapter.configSchema, not: { const: null } },
      }),
    ).toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_INVALID" }));
  });

  it("zeroizes every recognizable secret byte field even on hostile result shapes", () => {
    const accessToken = new Uint8Array([1, 2]);
    const refreshToken = new Uint8Array([3, 4]);
    const providerSubject = new Uint8Array([5, 6]);
    npZeroAgentProviderAuthResultV1({
      status: "success",
      credential: {
        accessToken,
        providerSubject: "malformed",
        refreshToken: { mode: "malformed", token: refreshToken },
      },
    } as unknown as Parameters<typeof npZeroAgentProviderAuthResultV1>[0]);
    npZeroAgentProviderProbeResultV1({
      providerSubject,
    } as unknown as Parameters<typeof npZeroAgentProviderProbeResultV1>[0]);
    expect(accessToken).toEqual(new Uint8Array(2));
    expect(refreshToken).toEqual(new Uint8Array(2));
    expect(providerSubject).toEqual(new Uint8Array(2));
  });
});
