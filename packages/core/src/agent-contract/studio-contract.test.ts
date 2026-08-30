import { describe, expect, it } from "vitest";

import {
  npAnalyzeAgentStudioAdapterV1,
  npAnalyzeAgentStudioOneTimeTokenV1,
  npDigestAgentStudioConnectionDefinitionV1,
  npRequireAgentStudioOverviewV1,
  npSerializeAgentStudioConnectionDefinitionV1,
} from "./studio-contract.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const PRINCIPAL_UUID = "22222222-2222-4222-8222-222222222222";
const DIGEST = `cj1:sha256:${"A".repeat(43)}`;

function adapter() {
  return {
    schemaVersion: "np.agent-studio-adapter.v1",
    id: "fake-provider",
    contractVersion: 1,
    fingerprint: DIGEST,
    supportedConnectionKinds: ["model"],
    supportedAuthKinds: ["api_key", "oauth"],
    configSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: { modelId: { type: "string", maxLength: 128 } },
      required: ["modelId"],
    },
    oauth: {
      authorizationOrigins: ["https://provider.example"],
      permissionInventory: ["account.read", "model.generate"],
    },
  };
}

function token() {
  return {
    schemaVersion: "np.agent-service-token.v1",
    id: UUID,
    siteId: "docs-site",
    principalId: PRINCIPAL_UUID,
    name: "Editorial CLI",
    prefix: `npst1_${UUID}`,
    status: "active_head",
    scopes: ["site:read"],
    transport: "stdio",
    exposureMode: "read",
    audience: "urn:nexpress:agent-gateway:stdio",
    rowVersion: 1,
    expiresAt: "2026-09-27T00:00:00.000Z",
    lastUsedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    overlapExpiresAt: null,
    revokedAt: null,
  };
}

describe("Agent Studio client-safe contract", () => {
  it("locks canonical connection definitions and their browser-safe digest", async () => {
    const definition = {
      schemaVersion: "np.agent-studio-connection-definition.v1" as const,
      name: "Editorial model",
      kind: "model" as const,
      provider: "fake-provider",
      adapterId: "fake-provider",
      adapterContractVersion: 1,
      adapterFingerprint: DIGEST,
      authKind: "api_key" as const,
      config: { modelId: "fake-model" },
      dataProcessingCeiling: "public-only" as const,
    };
    expect(npSerializeAgentStudioConnectionDefinitionV1(definition)).toBe(
      '{"adapterContractVersion":1,"adapterFingerprint":"cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","adapterId":"fake-provider","authKind":"api_key","config":{"modelId":"fake-model"},"dataProcessingCeiling":"public-only","kind":"model","name":"Editorial model","provider":"fake-provider","schemaVersion":"np.agent-studio-connection-definition.v1"}',
    );
    await expect(npDigestAgentStudioConnectionDefinitionV1(definition)).resolves.toMatch(
      /^cj1:sha256:[A-Za-z0-9_-]{43}$/u,
    );
  });

  it("projects metadata only and rejects executable or unknown adapter members", () => {
    expect(npAnalyzeAgentStudioAdapterV1(adapter())).toMatchObject({ ok: true });
    expect(
      npAnalyzeAgentStudioAdapterV1({
        ...adapter(),
        probeCredential: () => ({ accessToken: "secret" }),
      }),
    ).toMatchObject({ ok: false });
    expect(JSON.stringify(npAnalyzeAgentStudioAdapterV1(adapter()))).not.toMatch(
      /accessToken|clientSecret|credentialMaterial/u,
    );
  });

  it("keeps the disabled empty state valid and site-scoped", () => {
    expect(
      npRequireAgentStudioOverviewV1({
        schemaVersion: "np.agent-studio-overview.v1",
        siteId: "docs-site",
        runtime: {
          schemaVersion: "np.agent-studio-runtime.v1",
          connections: {
            state: "unavailable",
            issueCode: "AGENT_CONNECTION_RUNTIME_UNAVAILABLE",
          },
          gateway: {
            state: "unavailable",
            issueCode: "AGENT_GATEWAY_RUNTIME_UNAVAILABLE",
          },
        },
        gatewaySettings: {
          schemaVersion: "np.agent-gateway-settings.v1",
          stdio: "disabled",
          mcpHttp: "disabled",
          agentHttp: "disabled",
        },
        adapters: [],
        connections: [],
        principals: [],
      }),
    ).toMatchObject({ siteId: "docs-site", connections: [], principals: [] });
  });

  it("accepts one exact one-time token value and rejects replay-shaped extras", () => {
    const value = `npst1_${UUID}_${"A".repeat(43)}`;
    expect(
      npAnalyzeAgentStudioOneTimeTokenV1({
        schemaVersion: "np.agent-studio-one-time-token.v1",
        token: token(),
        value,
      }),
    ).toMatchObject({ ok: true });
    expect(
      npAnalyzeAgentStudioOneTimeTokenV1({
        schemaVersion: "np.agent-studio-one-time-token.v1",
        token: token(),
        value,
        tokenHash: "must-not-project",
      }),
    ).toMatchObject({ ok: false });
    expect(
      npAnalyzeAgentStudioOneTimeTokenV1({
        schemaVersion: "np.agent-studio-one-time-token.v1",
        token: token(),
        value: `${value}A`,
      }),
    ).toMatchObject({ ok: false });
  });
});
