import { describe, expect, it } from "vitest";

import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentConnectionConfigCanonicalExcludedKeysV1,
  npAgentConnectionConfigCanonicalIncludedKeysV1,
  npAgentConnectionDestinationCanonicalExcludedKeysV1,
  npAgentConnectionDestinationCanonicalIncludedKeysV1,
  npAgentConnectionOperationCanonicalExcludedKeysV1,
  npAgentConnectionOperationCanonicalIncludedKeysV1,
  npAnalyzeAgentConnectionConfigCanonical,
  npAnalyzeAgentConnectionDestinationCanonical,
  npAnalyzeAgentConnectionOperationCanonical,
  npDigestAgentConnectionConfigCanonical,
  npDigestAgentConnectionOperationCanonical,
  npMacAgentConnectionDestinationCanonical,
  npVerifyAgentConnectionDestinationCanonicalMac,
  type NpAgentConnectionConfigCanonicalV1,
  type NpAgentConnectionDestinationCanonicalV1,
  type NpAgentConnectionOperationRequestCanonicalV1,
  type NpAgentContractResult,
} from "./index.js";

const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const connectionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const operationId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const configSnapshotId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const invocationId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const secretVersionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd5";
const goldenConfigDigest = "cj1:sha256:4cuZeluejKrfS818q3YgJjlJousoGReTvOLzvHKES3M";
const goldenOperationDigest = "cj1:sha256:1l7Q4z5nr5Wj55dgxxm0oWrGeK6sQQb9QxGbsQfgPU4";
const goldenDestinationMac =
  "cj1:hmac-sha256:destination-key-1:boHGQmddaXmH50H0GaIxp3Ub_sv1YThbrjLdxk_iifY";

function connectionConfig(
  overrides: Partial<NpAgentConnectionConfigCanonicalV1> = {},
): NpAgentConnectionConfigCanonicalV1 {
  return {
    schemaVersion: "np.agent-connection-config.v1",
    siteId: "docs-site",
    connectionId,
    kind: "model",
    provider: "openai",
    adapterId: "openai.responses",
    adapterContractVersion: 1,
    adapterFingerprint: digestA,
    authKind: "api_key",
    configVersion: 3,
    config: { organization: "demo" },
    pricingCatalog: [
      {
        schemaVersion: "np.agent-model-pricing.v1",
        pricingId: "gpt5.input",
        version: 1,
        fingerprint: "pr1:sha256:PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
        modelId: "gpt-5",
        currency: "USD",
        unitTokens: 1_000_000,
        inputMicrosPerUnit: 1_250_000,
        cachedInputMicrosPerUnit: 125_000,
        outputMicrosPerUnit: 10_000_000,
        minimumRequestMicros: 0,
        rounding: "ceil-each-component",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveUntil: null,
      },
    ],
    dataProcessingCeiling: "internal-redacted",
    ...overrides,
  };
}

function destination(
  overrides: Partial<NpAgentConnectionDestinationCanonicalV1> = {},
): NpAgentConnectionDestinationCanonicalV1 {
  return {
    schemaVersion: "np.agent-connection-destination.v1",
    siteId: "docs-site",
    connectionId,
    adapterId: "slack.notifications",
    adapterContractVersion: 2,
    adapterFingerprint: digestA,
    accountSubjectKeyId: "account-key-1",
    accountSubjectDigest: "S".repeat(43),
    destinationDescriptor: {
      schemaVersion: "np.agent-connection-destination-descriptor.v1",
      kind: "notification",
      adapterId: "slack.notifications",
      descriptor: { channelId: "C012345", workspace: "support" },
    },
    ...overrides,
  };
}

function operation(
  overrides: Partial<NpAgentConnectionOperationRequestCanonicalV1> = {},
): NpAgentConnectionOperationRequestCanonicalV1 {
  return {
    schemaVersion: "np.agent-connection-operation.v1",
    siteId: "docs-site",
    operationId,
    connectionId,
    authority: { kind: "admin-invocation", invocationId },
    kind: "activate-config",
    expectedConfigVersion: 3,
    expectedConfigHash: digestA,
    configSnapshotId,
    adapterContractVersion: 2,
    adapterFingerprint: digestA,
    inputSecretVersionIds: [secretVersionId],
    expectedSecretVersionId: secretVersionId,
    expectedCredentialVersion: 4,
    expectedRefreshGeneration: null,
    idempotencyKey: `connection:${operationId}`,
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe("Agent connection canonical bodies", () => {
  it("exports the three exact field and excluded-field fixtures", () => {
    expect(npAgentConnectionConfigCanonicalIncludedKeysV1).toHaveLength(13);
    expect(npAgentConnectionDestinationCanonicalIncludedKeysV1).toHaveLength(9);
    expect(npAgentConnectionOperationCanonicalIncludedKeysV1).toHaveLength(16);
    expect(npAgentConnectionConfigCanonicalExcludedKeysV1).toContain("activeSecretVersionId");
    expect(npAgentConnectionDestinationCanonicalExcludedKeysV1).toContain("accessToken");
    expect(npAgentConnectionOperationCanonicalExcludedKeysV1).toContain("deadlineAt");
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-connection-config.v1"]).toBe(512 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-connection-destination.v1"]).toBe(32 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-connection-operation.v1"]).toBe(64 * 1024);
  });

  it("accepts exact config, destination, and operation bodies with independent vectors", async () => {
    expect(npAnalyzeAgentConnectionConfigCanonical(connectionConfig()).ok).toBe(true);
    expect(npAnalyzeAgentConnectionDestinationCanonical(destination()).ok).toBe(true);
    expect(npAnalyzeAgentConnectionOperationCanonical(operation()).ok).toBe(true);
    expect(await npDigestAgentConnectionConfigCanonical(connectionConfig())).toBe(
      goldenConfigDigest,
    );
    expect(await npDigestAgentConnectionOperationCanonical(operation())).toBe(
      goldenOperationDigest,
    );
    const key = {
      owner: "connection-destination" as const,
      id: "destination-key-1",
      bytes: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    };
    const mac = await npMacAgentConnectionDestinationCanonical(destination(), key);
    expect(mac).toBe(goldenDestinationMac);
    expect(await npVerifyAgentConnectionDestinationCanonicalMac(destination(), mac, key)).toBe(
      true,
    );
    expect(
      await npVerifyAgentConnectionDestinationCanonicalMac(
        destination({ accountSubjectDigest: "T".repeat(43) }),
        mac,
        key,
      ),
    ).toBe(false);
  });

  it("enforces catalog ordering/non-overlap and connection-kind pricing", () => {
    expectIssue(
      npAnalyzeAgentConnectionConfigCanonical(
        connectionConfig({
          pricingCatalog: [
            connectionConfig().pricingCatalog[0],
            {
              ...connectionConfig().pricingCatalog[0],
              pricingId: "gpt5.new",
              effectiveFrom: "2026-06-01T00:00:00.000Z",
            },
          ],
        }),
      ),
      "invalid-field",
      "agent.canonical.connectionConfig.pricingCatalog[1]",
    );
    expectIssue(
      npAnalyzeAgentConnectionConfigCanonical(
        connectionConfig({
          kind: "notification",
          pricingCatalog: connectionConfig().pricingCatalog,
        }),
      ),
      "invalid-field",
      "agent.canonical.connectionConfig.pricingCatalog",
    );
  });

  it("rejects secret-shaped destination keys and mismatched descriptor adapters", () => {
    expectIssue(
      npAnalyzeAgentConnectionDestinationCanonical({
        ...destination(),
        destinationDescriptor: {
          ...destination().destinationDescriptor,
          descriptor: { accessToken: "secret" },
        },
      }),
      "unknown-field",
      "agent.canonical.connectionDestination.destinationDescriptor.descriptor.accessToken",
    );
    expectIssue(
      npAnalyzeAgentConnectionDestinationCanonical({
        ...destination(),
        destinationDescriptor: { ...destination().destinationDescriptor, adapterId: "email.smtp" },
      }),
      "invalid-field",
      "agent.canonical.connectionDestination.destinationDescriptor.adapterId",
    );
  });

  it("enforces the lower config and destination descriptor component ceilings", () => {
    expectIssue(
      npAnalyzeAgentConnectionConfigCanonical(
        connectionConfig({ config: { value: "x".repeat(256 * 1024) } }),
      ),
      "limit",
      "agent.canonical.connectionConfig.config.value",
    );
    expectIssue(
      npAnalyzeAgentConnectionDestinationCanonical({
        ...destination(),
        destinationDescriptor: {
          ...destination().destinationDescriptor,
          descriptor: { value: "x".repeat(16 * 1024) },
        },
      }),
      "limit",
      "agent.canonical.connectionDestination.destinationDescriptor.descriptor.value",
    );
  });

  it("enforces authority and expected-version null matrices", () => {
    expectIssue(
      npAnalyzeAgentConnectionOperationCanonical(
        operation({ kind: "oauth-refresh", expectedRefreshGeneration: 3 }),
      ),
      "invalid-field",
      "agent.canonical.connectionOperation.authority.kind",
    );
    expectIssue(
      npAnalyzeAgentConnectionOperationCanonical(operation({ expectedCredentialVersion: null })),
      "invalid-field",
      "agent.canonical.connectionOperation.expectedSecretVersionId",
    );
    expectIssue(
      npAnalyzeAgentConnectionOperationCanonical({
        ...operation(),
        deadlineAt: "2026-01-01T00:00:00.000Z",
      }),
      "unknown-field",
      "agent.canonical.connectionOperation.deadlineAt",
    );
  });
});
