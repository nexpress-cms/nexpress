import { describe, expect, it, vi } from "vitest";

import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentProviderRequestCanonicalExcludedKeysV1,
  npAgentProviderRequestCanonicalIncludedKeysV1,
  npAgentProviderResponseCanonicalExcludedKeysV1,
  npAgentProviderResponseCanonicalIncludedKeysV1,
  npAnalyzeAgentProviderRequestCanonical,
  npAnalyzeAgentProviderResponseCanonical,
  npDigestAgentProviderRequestCanonical,
  npDigestAgentProviderResponseCanonical,
  type NpAgentContractResult,
  type NpAgentProviderRequestCanonicalV1,
  type NpAgentProviderResponseCanonicalV1,
} from "./index.js";

const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const providerCallId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const runId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const connectionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const configSnapshotId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const secretVersionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd5";
const goldenRequestDigest = "cj1:sha256:id5wweMfdv1bGFwsvhqhaf2JK7TcVj_WCMLJZi3_ZrY";
const goldenResponseDigest = "cj1:sha256:cJVETObMZVijTUxjGxB4mpjmeXl6Lq-M-o-k0mQtj6E";
const responseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema" as const,
  type: "object" as const,
  additionalProperties: false as const,
  required: ["task", "decision"],
  properties: {
    task: { type: "string", enum: ["interactive-capability"], maxLength: 64 },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { type: "string", maxLength: 64 } },
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

function providerRequest(
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

function providerResponse(
  overrides: Partial<NpAgentProviderResponseCanonicalV1> = {},
): NpAgentProviderResponseCanonicalV1 {
  const decision = {
    task: "interactive-capability" as const,
    decision: { kind: "complete" as const, summary: "The bounded evidence was assessed." },
  };
  return {
    schemaVersion: "np.agent-provider-response.v1",
    siteId: "docs-site",
    providerCallId,
    runId,
    requestDigest: digestA,
    dispatchState: "dispatched",
    outcome: {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "succeeded",
      provider: "openai",
      model: "gpt-5",
      providerRequestId: "req_123",
      output: {
        task: "interactive-capability",
        decision: { kind: "complete", summary: "The bounded evidence was assessed." },
      },
      usage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 40,
        tokenSource: "provider",
        costMicros: 525,
        costSource: "provider",
      },
      finishReason: "stop",
      latencyMs: 1_250,
    },
    decision,
    observedAt: "2026-08-26T01:02:03.004Z",
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe("Agent provider request and response canonical bodies", () => {
  it("exports exact request/response field and exclusion fixtures", () => {
    expect(npAgentProviderRequestCanonicalIncludedKeysV1).toHaveLength(24);
    expect(npAgentProviderResponseCanonicalIncludedKeysV1).toHaveLength(9);
    expect(npAgentProviderRequestCanonicalExcludedKeysV1).toContain("providerRequestId");
    expect(npAgentProviderResponseCanonicalExcludedKeysV1).toContain("responseDigest");
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-provider-request.v1"]).toBe(4 * 1024 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-provider-response.v1"]).toBe(4 * 1024 * 1024);
  });

  it("accepts exact request/response bodies and independent golden vectors", async () => {
    expect(npAnalyzeAgentProviderRequestCanonical(providerRequest())).toEqual({
      ok: true,
      value: providerRequest(),
    });
    expect(npAnalyzeAgentProviderResponseCanonical(providerResponse())).toEqual({
      ok: true,
      value: providerResponse(),
    });
    expect(await npDigestAgentProviderRequestCanonical(providerRequest())).toBe(
      goldenRequestDigest,
    );
    expect(await npDigestAgentProviderResponseCanonical(providerResponse())).toBe(
      goldenResponseDigest,
    );
  });

  it("recomputes source/class ceilings and enforces tuple ordering", () => {
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical({
        ...providerRequest(),
        instruction: {
          ...providerRequest().instruction,
          classification: classification("internal-redacted", digestB),
        },
      }),
      "invalid-field",
      "agent.canonical.providerRequest.instruction.classification.sourceDigest",
    );
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical(
        providerRequest({ dataClass: "public-only", dataClassCeiling: "public-only" }),
      ),
      "invalid-field",
      "agent.canonical.providerRequest.dataClass",
    );
    const trusted = providerRequest().trustedContext[0];
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical(
        providerRequest({
          trustedContext: [
            { ...trusted, id: "policy-z", classification: { ...trusted.classification } },
            { ...trusted, id: "policy-a", classification: { ...trusted.classification } },
          ],
        }),
      ),
      "order",
      "agent.canonical.providerRequest.trustedContext[1]",
    );
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical(
        providerRequest({
          tools: [
            {
              capabilityId: "site.inspect",
              descriptorFingerprint: digestA,
              classification: classification("public-only", digestB),
              inputSchema: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                additionalProperties: false,
                required: [],
                properties: {},
              },
            },
          ],
        }),
      ),
      "invalid-field",
      "agent.canonical.providerRequest.tools[0].classification.sourceDigest",
    );
  });

  it("binds recipe tasks, tool availability, and context component limits", () => {
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical(
        providerRequest({
          recipe: { id: "guardian.agent-abuse", version: 1, fingerprint: digestA },
        }),
      ),
      "invalid-field",
      "agent.canonical.providerRequest.task",
    );
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical(
        providerRequest({
          recipe: { id: "guardian.agent-abuse", version: 1, fingerprint: digestA },
          task: "guardian-assessment",
          tools: [
            {
              capabilityId: "site.inspect",
              descriptorFingerprint: digestA,
              classification: classification("public-only", digestA),
              inputSchema: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                additionalProperties: false,
                required: [],
                properties: {},
              },
            },
          ],
        }),
      ),
      "invalid-field",
      "agent.canonical.providerRequest.tools",
    );
    const contexts = Array.from({ length: 65 }, (_, index) => ({
      id: `context-${index.toString().padStart(2, "0")}`,
      kind: "policy" as const,
      digest: digestA,
      classification: classification("public-only", digestA),
      text: "bounded",
    }));
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical(providerRequest({ trustedContext: contexts })),
      "limit",
      "agent.canonical.providerRequest.trustedContext",
    );
    const largeContexts = Array.from({ length: 9 }, (_, index) => ({
      id: `context-${index.toString().padStart(2, "0")}`,
      kind: "policy" as const,
      digest: digestA,
      classification: classification("public-only", digestA),
      text: "x".repeat(250_000),
    }));
    expectIssue(
      npAnalyzeAgentProviderRequestCanonical(providerRequest({ trustedContext: largeContexts })),
      "limit",
      "agent.canonical.providerRequest.trustedContext",
    );
  });

  it("binds outer dispatch to outcome and successful decision to parsed output", () => {
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical(providerResponse({ dispatchState: "unknown" })),
      "invalid-field",
      "agent.canonical.providerResponse.dispatchState",
    );
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical(
        providerResponse({
          decision: {
            task: "interactive-capability",
            decision: { kind: "complete", summary: "Different output" },
          },
        }),
      ),
      "invalid-field",
      "agent.canonical.providerResponse.decision",
    );
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical({
        ...providerResponse(),
        responseDigest: digestA,
      }),
      "unknown-field",
      "agent.canonical.providerResponse.responseDigest",
    );
  });

  it("enforces pre-dispatch and ambiguous outcome matrices", () => {
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical(
        providerResponse({
          dispatchState: "not-dispatched",
          outcome: {
            schemaVersion: "np.agent-provider-invoke-outcome.v1",
            status: "failed",
            provider: "openai",
            model: "gpt-5",
            providerRequestId: "req_should_be_null",
            output: null,
            errorClass: "authentication",
            safeCode: "AUTHENTICATION_FAILED",
            retryable: false,
            dispatchState: "not-dispatched",
            usage: null,
            finishReason: null,
            latencyMs: 0,
          },
          decision: null,
        }),
      ),
      "invalid-field",
      "agent.canonical.providerResponse.outcome",
    );
  });

  it("enforces dispatched finish-reason and retryable failure matrices", () => {
    const failed = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1" as const,
      status: "failed" as const,
      provider: "openai",
      model: "gpt-5",
      providerRequestId: "req_failed",
      output: null,
      errorClass: "content-policy" as const,
      safeCode: "CONTENT_POLICY_BLOCKED",
      retryable: false,
      dispatchState: "dispatched" as const,
      usage: null,
      finishReason: null,
      latencyMs: 50,
    };
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical(
        providerResponse({ outcome: failed, decision: null }),
      ),
      "invalid-field",
      "agent.canonical.providerResponse.outcome.finishReason",
    );
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical(
        providerResponse({
          outcome: {
            ...failed,
            errorClass: "authentication",
            safeCode: "AUTHENTICATION_FAILED",
            retryable: true,
            finishReason: null,
          },
          decision: null,
        }),
      ),
      "invalid-field",
      "agent.canonical.providerResponse.outcome.retryable",
    );
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical(
        providerResponse({
          outcome: {
            ...failed,
            errorClass: "transient",
            safeCode: "PROVIDER_TRANSIENT",
            finishReason: "content-filter",
          },
          decision: null,
        }),
      ),
      "invalid-field",
      "agent.canonical.providerResponse.outcome.finishReason",
    );
    expect(
      npAnalyzeAgentProviderResponseCanonical(
        providerResponse({
          outcome: {
            ...failed,
            errorClass: "rate-limited",
            safeCode: "PROVIDER_RATE_LIMITED",
            retryable: true,
            finishReason: null,
          },
          decision: null,
        }),
      ).ok,
    ).toBe(true);
  });

  it("does not invoke hostile provider-response accessors", () => {
    const getter = vi.fn(() => digestA);
    const body = providerResponse() as unknown as Record<string, unknown>;
    Object.defineProperty(body, "responseDigest", { enumerable: true, get: getter });
    expectIssue(
      npAnalyzeAgentProviderResponseCanonical(body),
      "shape",
      "agent.canonical.providerResponse.responseDigest",
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
