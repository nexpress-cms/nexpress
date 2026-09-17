import { createHash } from "node:crypto";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";
import { describe, expect, it, vi } from "vitest";
import { npRequireAgentEvidenceRequestV1 } from "../agent-contract/canonical-provider.js";
import {
  createAgentRuntimeContextV1,
  npProjectAgentRuntimeActionOutcomeV1,
} from "./runtime-context.js";
import { npIsAgentRuntimeDocumentEvidenceReaderV1 } from "./read-capability-executors.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";
import { providerRequest } from "./provider-inference-fixture.js";
import { npDigestAgentRuntimeManualInputV1 } from "../agent-contract/runtime-manual-input.js";

const reference = {
  kind: "document",
  collection: "posts",
  documentId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  projection: "bounded-text",
};

async function manualContextFixture() {
  const request = providerRequest();
  const hash = (domain: string, value: unknown) =>
    `cj1:sha256:${createHash("sha256").update(domain).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
  const instructionDigest = `cj1:sha256:${createHash("sha256").update(request.instruction.text).digest("base64url")}`;
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: { topic: { type: "string", maxLength: 256 } },
    required: ["topic"],
  };
  const manualInput = { topic: "Review user@example.test with sk-private123456" };
  const current = {
    siteId: request.siteId,
    now: new Date("2026-09-12T00:00:00.000Z"),
    run: {
      id: request.runId,
      state: "running",
      attempt: 1,
      admissionFingerprint: request.recipe.fingerprint,
      leaseUntil: new Date("2026-09-12T00:05:00.000Z"),
      deadlineAt: new Date("2026-09-12T00:10:00.000Z"),
      queuedAt: new Date("2026-09-11T23:59:00.000Z"),
      recipeId: request.recipe.id,
      recipeVersion: 1,
      recipeFingerprint: request.recipe.fingerprint,
      providerDataClassCeiling: "sensitive-approved",
      instructionDigest,
      responseSchemaDigest: hash("np.agent-runtime-schema.v1", request.responseSchema),
      manualInputSchemaDigest: hash("np.agent-runtime-schema.v1", schema),
      manualInput,
      manualInputDigest: await npDigestAgentRuntimeManualInputV1(manualInput),
      goal: "Check staff@example.test",
    },
    evidence: {
      principal: {},
      version: {},
      definition: { model: request.model },
      registry: {
        recipes: [
          {
            id: request.recipe.id,
            version: 1,
            task: "interactive-capability",
            providerMode: "required",
            triggerKinds: ["manual"],
            capabilityIds: [],
            instruction: {
              templateId: request.instruction.templateId,
              templateVersion: request.instruction.templateVersion,
              text: request.instruction.text,
              digest: instructionDigest,
            },
            manualInputSchema: schema,
            responseSchema: request.responseSchema,
          },
        ],
      },
    },
    policy: { instructions: [], effective: { providerDataMaximum: "sensitive-approved" } },
    settings: {},
    limits: { ...request.limits, maxWallClockSeconds: 300 },
    connection: {
      id: request.connection.id,
      provider: request.provider,
      activeSecretVersionId: request.connection.secretVersionId,
      credentialVersion: request.connection.credentialVersion,
    },
    connectionSnapshot: {
      id: request.connection.configSnapshotId,
      version: request.connection.configVersion,
      configHash: request.connection.configHash,
      adapterId: request.connection.adapterId,
      adapterContractVersion: request.connection.adapterContractVersion,
      adapterFingerprint: request.connection.adapterFingerprint,
    },
    pricing: request.pricing,
  } as unknown as NpAgentRuntimeRunContextV1;
  const admission = {
    admit: vi.fn(),
    withRunAuthority: vi.fn(),
    withCurrentRun: vi.fn((_input, execute) => execute(current)),
  } as NpAgentRuntimeAdmissionV1;
  return {
    current,
    service: createAgentRuntimeContextV1({ admission }),
    input: {
      siteId: request.siteId,
      runId: request.runId,
      providerCallId: request.providerCallId,
      sequence: 1,
      retryOfId: null,
      idempotencyKey: request.idempotencyKey,
    },
  };
}

describe("Retained structured manual input", () => {
  it("consumes redacted untrusted input and rebuilds the same request for verification", async () => {
    const { current, service, input } = await manualContextFixture();
    const request = await service.prepare(input);
    expect(request.untrustedEvidence).toEqual([
      {
        id: "manual-input",
        kind: "content",
        digest: current.run.manualInputDigest,
        observedAt: current.run.queuedAt.toISOString(),
        classification: {
          sourceDigest: current.run.manualInputDigest,
          dataClass: "sensitive-approved",
          classifierId: "framework.runtime-context",
          classifierVersion: 1,
        },
        text: '{"goal":"Check [redacted email]","input":{"topic":"Review [redacted email] with [redacted credential]"}}',
      },
    ]);
    expect(request.dataClass).toBe("sensitive-approved");
    expect(request.trustedContext).toEqual([]);
    expect(request.tools).toEqual([]);
    expect(await service.verifyRequest(current, request)).toBe(true);
    current.run.manualInput = { topic: "changed after preparation" };
    expect(await service.verifyRequest(current, request)).toBe(false);
  });

  it("rejects modified digest, schema binding and insufficient provider ceilings", async () => {
    const mutations: ((current: NpAgentRuntimeRunContextV1) => void)[] = [
      (current) => {
        current.run.manualInputDigest = current.run.instructionDigest;
      },
      (current) => {
        current.run.manualInputSchemaDigest = current.run.instructionDigest;
      },
      (current) => {
        current.run.providerDataClassCeiling = "internal-redacted";
      },
      (current) => {
        current.policy.effective.providerDataMaximum = "internal-redacted";
      },
    ];
    for (const mutate of mutations) {
      const { current, service, input } = await manualContextFixture();
      mutate(current);
      await expect(service.prepare(input)).rejects.toMatchObject({
        code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE",
      });
    }
  });

  it("preserves the schema-null goal-only context", async () => {
    const { current, service, input } = await manualContextFixture();
    current.run.manualInput = null;
    current.run.manualInputDigest = null;
    current.run.manualInputSchemaDigest = null;
    current.evidence.registry.recipes[0].manualInputSchema = null;
    const request = await service.prepare(input);
    expect(request.untrustedEvidence).toEqual([]);
    expect(request.dataClass).toBe("internal-redacted");
  });
});

describe("Runtime context source boundary", () => {
  it("reuses the closed evidence owner without exposing arbitrary selectors", () => {
    expect(npRequireAgentEvidenceRequestV1(reference)).toEqual(reference);
    for (const input of [
      { ...reference, url: "https://example.test" },
      { ...reference, query: "select * from users" },
      { ...reference, classification: "public-only" },
      { ...reference, projection: "raw" },
      { ...reference, collection: "posts", documentId: "x".repeat(129) },
      { kind: "url", url: "https://example.test" },
      { kind: "plugin", method: "invoke" },
    ])
      expect(() => npRequireAgentEvidenceRequestV1(input)).toThrow();
  });

  it("does not evaluate attacker-controlled source getters", () => {
    const getter = vi.fn(() => "posts");
    const value = Object.defineProperty({ ...reference }, "collection", {
      get: getter,
      enumerable: true,
    });
    expect(() => npRequireAgentEvidenceRequestV1(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects a generic callback masquerading as the framework document reader", () => {
    expect(npIsAgentRuntimeDocumentEvidenceReaderV1({ read: vi.fn(), projectText: vi.fn() })).toBe(
      false,
    );
  });

  it("rejects over-bound or duplicate requests before touching current authority", async () => {
    const withCurrentRun = vi.fn();
    const admission: NpAgentRuntimeAdmissionV1 = {
      admit: vi.fn(),
      withCurrentRun,
      withRunAuthority: vi.fn(),
    };
    const context = createAgentRuntimeContextV1({ admission });
    const base = {
      siteId: "default",
      runId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
      providerCallId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
      sequence: 1,
      retryOfId: null,
      idempotencyKey: "fixture",
    };
    const parsed = npRequireAgentEvidenceRequestV1(reference);
    await expect(
      context.prepare({ ...base, evidence: Array.from({ length: 33 }, () => parsed) }),
    ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE" });
    await expect(context.prepare({ ...base, evidence: [parsed, parsed] })).rejects.toMatchObject({
      code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE",
    });
    expect(withCurrentRun).not.toHaveBeenCalled();
  });
});

it("awaits installed capability discovery and contains a rejected async source", async () => {
  const text = "Fixed instructions";
  const digest = `cj1:sha256:${createHash("sha256").update(text).digest("base64url")}`;
  const schema = { type: "object", additionalProperties: false, properties: {}, required: [] };
  const schemaDigest = `cj1:sha256:${createHash("sha256").update("np.agent-runtime-schema.v1").update("\0").update(serializeAgentCanonicalJson(schema)).digest("base64url")}`;
  const runId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
  const current = {
    siteId: "default",
    now: new Date("2026-09-12T00:00:00.000Z"),
    run: {
      id: runId,
      recipeId: "fixture",
      recipeVersion: 1,
      providerDataClassCeiling: "sensitive-approved",
      instructionDigest: digest,
      responseSchemaDigest: schemaDigest,
    },
    evidence: {
      definition: { model: "fixture" },
      registry: {
        recipes: [
          {
            id: "fixture",
            version: 1,
            task: "interactive-capability",
            instruction: { text, digest },
            responseSchema: schema,
          },
        ],
      },
    },
    connection: { activeSecretVersionId: "secret-version", credentialVersion: 1 },
    connectionSnapshot: {},
    pricing: {},
  } as unknown as NpAgentRuntimeRunContextV1;
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, onReject) => {
    reject = onReject;
  });
  const list = vi.fn(() => pending);
  const admission = {
    admit: vi.fn(),
    withRunAuthority: vi.fn(),
    withCurrentRun: vi.fn((_input, execute) => execute(current)),
  } as NpAgentRuntimeAdmissionV1;
  const service = createAgentRuntimeContextV1({ admission, capabilities: { list } });
  const prepared = service.prepare({
    siteId: "default",
    runId,
    providerCallId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
    sequence: 1,
    retryOfId: null,
    idempotencyKey: "fixture",
  });
  const rejected = expect(prepared).rejects.toMatchObject({
    code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE",
  });
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  reject(new Error("private source failure"));
  await rejected;
});

describe("Runtime ChangeSet action references", () => {
  const digest = `cj1:sha256:${"A".repeat(43)}`;
  const item = {
    changeSetId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
    state: "ready",
    draftVersion: 2,
    draftHash: digest,
    planHash: digest,
    previewId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
    previewState: "ready",
    approvalId: null,
    approvalState: null,
    executionId: null,
    executionState: null,
    rollbackPlanId: null,
    rollbackPlanHash: null,
    rollbackState: null,
  };
  const current = {
    policy: {
      effective: {
        capabilityModes: [
          { capabilityId: "changeset.create", mode: "approved" },
          { capabilityId: "content.query", mode: "observe" },
        ],
      },
    },
  } as unknown as Pick<NpAgentRuntimeRunContextV1, "policy">;
  const outcome = () => ({
    capabilityId: "changeset.create",
    state: "succeeded",
    safeCode: null,
    references: { changeSets: [structuredClone(item)], nextCursor: null },
  });

  it("retains the exact identifiers, versions and hashes needed for the next descriptor call", () => {
    const projected = npProjectAgentRuntimeActionOutcomeV1(current, outcome());
    expect(projected.references?.changeSets[0]).toEqual(item);
    expect(projected.references?.changeSets[0]).toMatchObject({
      changeSetId: item.changeSetId,
      draftVersion: 2,
      draftHash: digest,
      planHash: digest,
      previewState: "ready",
    });
    expect(Object.keys(projected.references!.changeSets[0])).toEqual(Object.keys(item));
  });

  it("rejects content, credentials, locators, unknown states and unbounded references", () => {
    for (const field of ["title", "name", "body", "input", "locator", "credential", "reasoning"]) {
      const value = outcome();
      Object.assign(value.references.changeSets[0], { [field]: "private-data" });
      expect(() => npProjectAgentRuntimeActionOutcomeV1(current, value)).toThrow();
    }
    for (const fields of [
      { state: "invented" },
      { previewState: "approved" },
      { draftVersion: 0 },
      { draftHash: "raw-value" },
      { approvalState: "approved" },
    ]) {
      const value = outcome();
      Object.assign(value.references.changeSets[0], fields);
      expect(() => npProjectAgentRuntimeActionOutcomeV1(current, value)).toThrow();
    }
    expect(() =>
      npProjectAgentRuntimeActionOutcomeV1(current, {
        ...outcome(),
        references: {
          changeSets: Array.from({ length: 101 }, () => structuredClone(item)),
          nextCursor: null,
        },
      }),
    ).toThrow();
    expect(() =>
      npProjectAgentRuntimeActionOutcomeV1(current, {
        ...outcome(),
        references: {
          changeSets: [structuredClone(item), structuredClone(item)],
          nextCursor: null,
        },
      }),
    ).toThrow();
  });

  it("does not evaluate injected getters or turn pending approval into planner evidence", () => {
    const getter = vi.fn(() => "private-data");
    const value = outcome();
    Object.defineProperty(value.references.changeSets[0], "draftHash", {
      get: getter,
      enumerable: true,
    });
    expect(() => npProjectAgentRuntimeActionOutcomeV1(current, value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      npProjectAgentRuntimeActionOutcomeV1(current, { ...outcome(), state: "approval_pending" }),
    ).toThrow();
    expect(() =>
      npProjectAgentRuntimeActionOutcomeV1(current, {
        ...outcome(),
        capabilityId: "content.query",
      }),
    ).toThrow();
  });
});
