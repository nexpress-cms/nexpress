import type {
  NpAgentProviderRequestCanonicalV1,
  NpAgentProviderInvokeOutcomeV1,
} from "../agent-contract/types.js";
import type {
  NpAgentConnectionAuthAdapterV1,
  NpAgentParsedConnectionConfigV1,
} from "./provider-auth-contract.js";
import type { NpProviderCredentialLeaseV1 } from "./vault-contract.js";
const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const providerCallId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const runId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const connectionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const configSnapshotId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const secretVersionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd5";
const responseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema" as const,
  type: "object" as const,
  additionalProperties: false as const,
  required: ["task", "decision"],
  properties: {
    task: { const: "interactive-capability" },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "summary"],
      properties: { kind: { const: "complete" }, summary: { type: "string", maxLength: 4096 } },
    },
  },
};
function classification(dataClass: "public-only" | "internal-redacted", sourceDigest: string) {
  return {
    dataClass,
    classifierId: "runtime.classifier",
    classifierVersion: 1,
    sourceDigest,
  } as const;
}

export function providerRequest(
  overrides: Partial<NpAgentProviderRequestCanonicalV1> = {},
): NpAgentProviderRequestCanonicalV1 {
  return {
    schemaVersion: "np.agent-provider-request.v1",
    siteId: "docs-site",
    providerCallId,
    runId,
    sequence: 1,
    retryOfId: null,
    idempotencyKey: `provider:${providerCallId}`,
    connection: {
      id: connectionId,
      configSnapshotId,
      configVersion: 2,
      configHash: digestA,
      secretVersionId,
      credentialVersion: 3,
      adapterId: "openai.responses",
      adapterContractVersion: 1,
      adapterFingerprint: digestA,
    },
    provider: "openai",
    model: "gpt-5",
    recipe: { id: "operator.worker-not-draining", version: 1, fingerprint: digestA },
    task: "interactive-capability",
    instruction: {
      templateId: "guardian.agent_abuse",
      templateVersion: 2,
      digest: digestA,
      classification: classification("internal-redacted", digestA),
      text: "Assess only the bounded supplied evidence.",
    },
    trustedContext: [
      {
        id: "policy-1",
        kind: "policy",
        digest: digestA,
        classification: classification("public-only", digestA),
        text: "No destructive actions.",
      },
    ],
    untrustedEvidence: [
      {
        id: "event-1",
        kind: "event",
        digest: digestB,
        observedAt: "2026-08-26T01:00:00.000Z",
        classification: classification("internal-redacted", digestB),
        text: "[redacted] repeated policy denial",
      },
    ],
    classificationManifestDigest: digestB,
    responseSchema,
    responseSchemaDigest: digestB,
    responseSchemaClassification: classification("public-only", digestB),
    tools: [],
    limits: { maxInputTokens: 8_000, maxOutputTokens: 2_000, timeoutSeconds: 60 },
    pricing: {
      schemaVersion: "np.agent-model-pricing.v1",
      pricingId: "gpt5.default",
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
    dataClass: "internal-redacted",
    dataClassCeiling: "internal-redacted",
    ...overrides,
  };
}

export function providerSuccess(): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "succeeded",
    provider: "fake-provider",
    model: "gpt-5",
    providerRequestId: "resp_test",
    output: { task: "interactive-capability", decision: { kind: "complete", summary: "Done" } },
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 2,
      tokenSource: "provider",
      costMicros: 33,
      costSource: "adapter-estimate",
    },
    finishReason: "stop",
    latencyMs: 1,
  };
}
export function providerInput(adapter: NpAgentConnectionAuthAdapterV1) {
  const request = providerRequest();
  request.provider = adapter.id;
  request.connection.adapterId = adapter.id;
  request.connection.adapterFingerprint = adapter.fingerprint;
  const connection: NpAgentParsedConnectionConfigV1 = {
    schemaVersion: "np.agent-parsed-connection-config.v1",
    connectionId: request.connection.id,
    adapterId: adapter.id,
    adapterContractVersion: adapter.contractVersion,
    adapterFingerprint: adapter.fingerprint,
    configVersion: request.connection.configVersion,
    configHash: request.connection.configHash,
    config: { modelId: request.model },
    pricingCatalog: [request.pricing],
    pricingCatalogFingerprint: digestA,
  };
  let disposed = false;
  const lease: NpProviderCredentialLeaseV1 = {
    secretVersionId: request.connection.secretVersionId,
    envelopeVersion: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
    async use(consumer) {
      if (disposed) throw new Error("Lease disposed");
      const secret = new TextEncoder().encode("test-only-openai-key");
      try {
        return await consumer({
          schemaVersion: "np.agent-credential-envelope.v1",
          kind: "api_key",
          adapterId: adapter.id,
          adapterContractVersion: adapter.contractVersion,
          adapterFingerprint: adapter.fingerprint,
          secret,
        });
      } finally {
        secret.fill(0);
      }
    },
    dispose() {
      disposed = true;
    },
  };
  return { request, connection, credentialLease: lease, isDisposed: () => disposed };
}
