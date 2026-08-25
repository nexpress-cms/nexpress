import { describe, expect, it, vi } from "vitest";

import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCausalDepthMaximumV1,
  npAgentProviderDataClassRank,
  npAgentProviderDataClasses,
  npAgentRunAdmissionAgentIncludedKeysV1,
  npAgentRunAdmissionCanonicalExcludedKeysV1,
  npAgentRunAdmissionCanonicalIncludedKeysV1,
  npAgentRunAdmissionConnectionIncludedKeysV1,
  npAgentRunAdmissionLineageIncludedKeysV1,
  npAgentRunAdmissionOrigins,
  npAgentRunAdmissionPolicyKinds,
  npAgentRunAdmissionPolicyRefIncludedKeysV1,
  npAgentRunAdmissionRecipeIncludedKeysV1,
  npAnalyzeAgentRunAdmissionCanonical,
  npBuildAgentRunAdmissionCanonicalBytes,
  npDigestAgentRunAdmissionCanonical,
  npRequireAgentRunAdmissionCanonical,
  type NpAgentContractResult,
  type NpAgentRunAdmissionCanonicalV1,
  type NpAgentRunAdmissionPolicyRefV1,
} from "./index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const digestC = "cj1:sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const pricingFingerprint = "pr1:sha256:PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP";
const principalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const invocationId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const triggerId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const agentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const agentVersionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd5";
const rootRunId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd6";
const connectionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd7";
const configSnapshotId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd8";
const parentRunId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd9";
const causalEventId = "018f0f30-cd7b-7cc2-8b16-8c052c259bda";
const causalActionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bdb";
const goldenDigest = "cj1:sha256:MWif6zNoclmqkUxIx-O3dpyxgoiJTobYRvOi-YoIPTA";

function runAdmission(
  overrides: Partial<NpAgentRunAdmissionCanonicalV1> = {},
): NpAgentRunAdmissionCanonicalV1 {
  return {
    schemaVersion: "np.agent-run-admission.v1",
    siteId: "docs-site",
    origin: "runtime",
    principalId,
    invocationId: null,
    triggerId,
    agent: {
      id: agentId,
      versionId: agentVersionId,
      configHash: digestA,
    },
    lineage: {
      rootRunId,
      parentRunId: null,
      causalDepth: 0,
      causalEventId: null,
      causalActionId: null,
    },
    recipe: {
      id: "guardian.agent-abuse",
      version: 1,
      fingerprint: digestB,
      instructionTemplateId: "guardian.agent_abuse",
      instructionTemplateVersion: 2,
      instructionDigest: digestC,
      responseSchemaDigest: digestA,
      manualInputSchemaDigest: null,
    },
    goal: "Assess the bounded Agent abuse signal",
    eventRef: {
      eventId: causalEventId,
      kind: "agent.policy-denied",
      count: 3,
      dimensions: ["scope", "velocity"],
    },
    policyRefs: [
      { kind: "agent-policy", id: agentId, version: 4, digest: digestC },
      { kind: "feature-setting", id: null, version: 2, digest: digestB },
      { kind: "framework", id: null, version: 1, digest: digestA },
      { kind: "site-policy", id: "site-policy-1", version: 7, digest: digestB },
    ],
    runLimitsHash: digestA,
    budgetSnapshotHash: digestB,
    idempotencyKey: "event:agent-abuse:0001",
    connection: {
      id: connectionId,
      configSnapshotId,
      configVersion: 3,
      configHash: digestC,
      dataClassCeiling: "internal-redacted",
      pricingId: "pricing.gpt4o",
      pricingVersion: 5,
      pricingFingerprint,
      pricingEffectiveAt: "2026-08-25T01:00:00.000Z",
    },
    admittedAt: "2026-08-25T01:00:00.000Z",
    deadlineAt: "2026-08-25T01:15:00.000Z",
    ...overrides,
  };
}

function gatewayAdmission(
  overrides: Partial<NpAgentRunAdmissionCanonicalV1> = {},
): NpAgentRunAdmissionCanonicalV1 {
  return runAdmission({
    origin: "gateway",
    invocationId,
    triggerId: null,
    agent: null,
    recipe: null,
    eventRef: null,
    connection: null,
    goal: "Execute one admitted Gateway capability",
    ...overrides,
  });
}

function deterministicAdmission(
  overrides: Partial<NpAgentRunAdmissionCanonicalV1> = {},
): NpAgentRunAdmissionCanonicalV1 {
  return runAdmission({
    connection: null,
    recipe: {
      ...runAdmission().recipe!,
      instructionTemplateId: null,
      instructionTemplateVersion: null,
      instructionDigest: null,
    },
    ...overrides,
  });
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

function boundaryPolicyRef(id: string): NpAgentRunAdmissionPolicyRefV1 {
  return { kind: "site-policy", id, version: 1, digest: digestA };
}

function canonicalByteLength(body: NpAgentRunAdmissionCanonicalV1): number {
  return encoder.encode(serializeAgentCanonicalJson(body)).byteLength;
}

function exactBoundaryAdmission(): NpAgentRunAdmissionCanonicalV1 {
  const maximum = npAgentCanonicalBodyMaxBytesV1["np.agent-run-admission.v1"];
  const baseBody = gatewayAdmission({ policyRefs: [] });
  const tailIds = ["x", "y", "z"];
  const withRefs = (count: number, pads: readonly number[]) =>
    gatewayAdmission({
      policyRefs: [
        ...Array.from({ length: count }, (_, index) =>
          boundaryPolicyRef(`a${index.toString().padStart(6, "0")}`),
        ),
        ...tailIds.map((prefix, index) =>
          boundaryPolicyRef(`${prefix}${prefix.repeat(pads[index] ?? 0)}`),
        ),
      ],
    });

  const emptyBytes = canonicalByteLength(baseBody);
  const oneEntryBytes = canonicalByteLength(
    gatewayAdmission({ policyRefs: [boundaryPolicyRef("a000000")] }),
  );
  const perEntryBytes = oneEntryBytes - emptyBytes;
  let count = Math.max(0, Math.floor((maximum - emptyBytes) / perEntryBytes) - tailIds.length);
  let candidate = withRefs(count, [0, 0, 0]);
  let remaining = maximum - canonicalByteLength(candidate);
  while (remaining < 0) {
    count -= 1;
    candidate = withRefs(count, [0, 0, 0]);
    remaining = maximum - canonicalByteLength(candidate);
  }
  while (remaining > tailIds.length * 127) {
    count += 1;
    candidate = withRefs(count, [0, 0, 0]);
    remaining = maximum - canonicalByteLength(candidate);
  }

  const pads = [0, 0, 0];
  for (let index = 0; index < pads.length; index += 1) {
    const next = Math.min(127, remaining);
    pads[index] = next;
    remaining -= next;
  }
  expect(remaining).toBe(0);
  return withRefs(count, pads);
}

describe("Agent run-admission canonical body", () => {
  it("publishes the literal top-level and nested contract fixtures", () => {
    expect(npAgentRunAdmissionOrigins).toEqual(["gateway", "runtime"]);
    expect(npAgentRunAdmissionPolicyKinds).toEqual([
      "agent-policy",
      "feature-setting",
      "framework",
      "site-policy",
    ]);
    expect(npAgentProviderDataClasses).toEqual([
      "public-only",
      "internal-redacted",
      "sensitive-approved",
    ]);
    expect(npAgentProviderDataClassRank).toEqual({
      "public-only": 0,
      "internal-redacted": 1,
      "sensitive-approved": 2,
    });
    expect(npAgentCausalDepthMaximumV1).toBe(4);
    expect(npAgentRunAdmissionCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "origin",
      "principalId",
      "invocationId",
      "triggerId",
      "agent",
      "lineage",
      "recipe",
      "goal",
      "eventRef",
      "policyRefs",
      "runLimitsHash",
      "budgetSnapshotHash",
      "idempotencyKey",
      "connection",
      "admittedAt",
      "deadlineAt",
    ]);
    expect(npAgentRunAdmissionCanonicalExcludedKeysV1).toEqual([
      "admissionHash",
      "admissionFingerprint",
      "runId",
      "state",
      "attempt",
      "providerRequestId",
      "usage",
      "result",
      "errorCode",
      "errorMessage",
      "queuedAt",
      "startedAt",
      "leaseUntil",
      "finishedAt",
    ]);
    expect(npAgentRunAdmissionAgentIncludedKeysV1).toEqual(["id", "versionId", "configHash"]);
    expect(npAgentRunAdmissionLineageIncludedKeysV1).toEqual([
      "rootRunId",
      "parentRunId",
      "causalDepth",
      "causalEventId",
      "causalActionId",
    ]);
    expect(npAgentRunAdmissionRecipeIncludedKeysV1).toEqual([
      "id",
      "version",
      "fingerprint",
      "instructionTemplateId",
      "instructionTemplateVersion",
      "instructionDigest",
      "responseSchemaDigest",
      "manualInputSchemaDigest",
    ]);
    expect(npAgentRunAdmissionPolicyRefIncludedKeysV1).toEqual(["kind", "id", "version", "digest"]);
    expect(npAgentRunAdmissionConnectionIncludedKeysV1).toEqual([
      "id",
      "configSnapshotId",
      "configVersion",
      "configHash",
      "dataClassCeiling",
      "pricingId",
      "pricingVersion",
      "pricingFingerprint",
      "pricingEffectiveAt",
    ]);
  });

  it("rebuilds independent provider, deterministic, and Gateway admissions", () => {
    const source = runAdmission();
    const parsed = npRequireAgentRunAdmissionCanonical(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.agent).not.toBe(source.agent);
    expect(parsed.lineage).not.toBe(source.lineage);
    expect(parsed.recipe).not.toBe(source.recipe);
    expect(parsed.eventRef).not.toBe(source.eventRef);
    expect(parsed.policyRefs).not.toBe(source.policyRefs);
    expect(parsed.policyRefs[0]).not.toBe(source.policyRefs[0]);
    expect(parsed.connection).not.toBe(source.connection);
    expect(npAnalyzeAgentRunAdmissionCanonical(deterministicAdmission()).ok).toBe(true);
    expect(npAnalyzeAgentRunAdmissionCanonical(gatewayAdmission()).ok).toBe(true);

    const negativeZero = runAdmission({ eventRef: { count: -0 } });
    expect(npRequireAgentRunAdmissionCanonical(negativeZero).eventRef).toEqual({ count: 0 });
  });

  it("enforces the Gateway, Runtime, recipe-instruction, and connection null matrix", () => {
    const invalid = [
      gatewayAdmission({ invocationId: null }),
      gatewayAdmission({ triggerId }),
      gatewayAdmission({ agent: runAdmission().agent }),
      gatewayAdmission({ recipe: runAdmission().recipe }),
      gatewayAdmission({ connection: runAdmission().connection }),
      runAdmission({ agent: null }),
      runAdmission({ recipe: null }),
      runAdmission({
        recipe: { ...runAdmission().recipe!, instructionTemplateVersion: null },
      }),
      deterministicAdmission({ connection: runAdmission().connection }),
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentRunAdmissionCanonical(value).ok).toBe(false);
    }
  });

  it("enforces root/child lineage and canonical identities, hashes, bounds, and times", () => {
    const validChild = runAdmission({
      lineage: {
        rootRunId,
        parentRunId,
        causalDepth: 1,
        causalEventId,
        causalActionId,
      },
    });
    expect(npAnalyzeAgentRunAdmissionCanonical(validChild).ok).toBe(true);

    const invalid = [
      runAdmission({ principalId: "not-a-uuid" }),
      runAdmission({ agent: { ...runAdmission().agent!, configHash: "sha256:raw" } }),
      runAdmission({ lineage: { ...runAdmission().lineage, parentRunId } }),
      runAdmission({
        lineage: { ...validChild.lineage, parentRunId: null },
      }),
      runAdmission({
        lineage: { ...validChild.lineage, causalActionId: null },
      }),
      runAdmission({
        lineage: { ...validChild.lineage, causalDepth: npAgentCausalDepthMaximumV1 + 1 },
      }),
      runAdmission({ idempotencyKey: "contains space" }),
      runAdmission({ goal: "" }),
      runAdmission({
        connection: { ...runAdmission().connection!, dataClassCeiling: "secret" as never },
      }),
      runAdmission({
        connection: { ...runAdmission().connection!, pricingFingerprint: digestA },
      }),
      runAdmission({
        connection: { ...runAdmission().connection!, pricingEffectiveAt: "2026-08-25" },
      }),
      runAdmission({ deadlineAt: runAdmission().admittedAt }),
      runAdmission({ deadlineAt: "2026-08-26T01:00:00.001Z" }),
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentRunAdmissionCanonical(value).ok).toBe(false);
    }
  });

  it("requires policy refs to be exact sorted unique tuples", () => {
    expectIssue(
      npAnalyzeAgentRunAdmissionCanonical(
        runAdmission({
          policyRefs: [
            { kind: "site-policy", id: "site-policy-1", version: 1, digest: digestA },
            { kind: "framework", id: null, version: 1, digest: digestA },
          ],
        }),
      ),
      "order",
      "agent.canonical.runAdmission.policyRefs[1]",
    );
    const duplicate = { kind: "framework", id: null, version: 1, digest: digestA } as const;
    expectIssue(
      npAnalyzeAgentRunAdmissionCanonical(
        runAdmission({ policyRefs: [duplicate, { ...duplicate }] }),
      ),
      "duplicate",
      "agent.canonical.runAdmission.policyRefs[1]",
    );
    expect(
      npAnalyzeAgentRunAdmissionCanonical(
        runAdmission({
          policyRefs: [
            { kind: "framework", id: null, version: 1, digest: digestA },
            { kind: "framework", id: null, version: 1, digest: digestB },
            { kind: "framework", id: "hard-rule", version: 1, digest: digestA },
            { kind: "framework", id: "hard-rule", version: 2, digest: digestA },
          ],
        }),
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentRunAdmissionCanonical(
        runAdmission({
          policyRefs: [{ kind: "unknown" as never, id: null, version: 1, digest: digestA }],
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects unknown fields and hostile event references without invoking accessors", () => {
    expect(npAnalyzeAgentRunAdmissionCanonical({ ...runAdmission(), runId: rootRunId }).ok).toBe(
      false,
    );
    expect(
      npAnalyzeAgentRunAdmissionCanonical(
        runAdmission({ agent: { ...runAdmission().agent!, state: "active" } as never }),
      ).ok,
    ).toBe(false);
    expect(npAnalyzeAgentRunAdmissionCanonical(runAdmission({ eventRef: [] as never })).ok).toBe(
      false,
    );
    expect(
      npAnalyzeAgentRunAdmissionCanonical(
        runAdmission({ eventRef: { count: Number.MAX_SAFE_INTEGER + 1 } }),
      ).ok,
    ).toBe(false);

    const shared = { id: "shared" };
    expect(
      npAnalyzeAgentRunAdmissionCanonical(
        runAdmission({ eventRef: shared, agent: shared as never }),
      ).ok,
    ).toBe(false);

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(npAnalyzeAgentRunAdmissionCanonical(runAdmission({ eventRef: cycle as never })).ok).toBe(
      false,
    );

    const getter = vi.fn(() => "not-read");
    const accessor = runAdmission();
    Object.defineProperty(accessor, "goal", { enumerable: true, get: getter });
    expect(npAnalyzeAgentRunAdmissionCanonical(accessor).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();

    const hostile = new Proxy(runAdmission(), {
      getPrototypeOf() {
        throw new Error("contained");
      },
    });
    expect(npAnalyzeAgentRunAdmissionCanonical(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("enforces the exact 512 KiB body ceiling", () => {
    const maximum = npAgentCanonicalBodyMaxBytesV1["np.agent-run-admission.v1"];
    const exact = exactBoundaryAdmission();
    const built = npBuildAgentRunAdmissionCanonicalBytes(exact);
    expect(built.canonicalJsonUtf8).toHaveLength(maximum);

    const policyRefs = exact.policyRefs.map((entry) => ({ ...entry }));
    const expandableIndex = policyRefs.findIndex((entry) => (entry.id?.length ?? 128) < 128);
    expect(expandableIndex).toBeGreaterThanOrEqual(0);
    const expandable = policyRefs[expandableIndex];
    policyRefs[expandableIndex] = { ...expandable, id: `${expandable.id}q` };
    expect(npAnalyzeAgentRunAdmissionCanonical({ ...exact, policyRefs }).ok).toBe(false);
  });

  it("locks source-key independence, domain separation, and the golden digest", async () => {
    const body = runAdmission();
    const reordered = {
      deadlineAt: body.deadlineAt,
      admittedAt: body.admittedAt,
      connection: body.connection
        ? {
            pricingEffectiveAt: body.connection.pricingEffectiveAt,
            pricingFingerprint: body.connection.pricingFingerprint,
            pricingVersion: body.connection.pricingVersion,
            pricingId: body.connection.pricingId,
            dataClassCeiling: body.connection.dataClassCeiling,
            configHash: body.connection.configHash,
            configVersion: body.connection.configVersion,
            configSnapshotId: body.connection.configSnapshotId,
            id: body.connection.id,
          }
        : null,
      idempotencyKey: body.idempotencyKey,
      budgetSnapshotHash: body.budgetSnapshotHash,
      runLimitsHash: body.runLimitsHash,
      policyRefs: body.policyRefs.map(({ digest, version, id, kind }) => ({
        digest,
        version,
        id,
        kind,
      })),
      eventRef: body.eventRef,
      goal: body.goal,
      recipe: body.recipe
        ? {
            manualInputSchemaDigest: body.recipe.manualInputSchemaDigest,
            responseSchemaDigest: body.recipe.responseSchemaDigest,
            instructionDigest: body.recipe.instructionDigest,
            instructionTemplateVersion: body.recipe.instructionTemplateVersion,
            instructionTemplateId: body.recipe.instructionTemplateId,
            fingerprint: body.recipe.fingerprint,
            version: body.recipe.version,
            id: body.recipe.id,
          }
        : null,
      lineage: {
        causalActionId: body.lineage.causalActionId,
        causalEventId: body.lineage.causalEventId,
        causalDepth: body.lineage.causalDepth,
        parentRunId: body.lineage.parentRunId,
        rootRunId: body.lineage.rootRunId,
      },
      agent: body.agent
        ? {
            configHash: body.agent.configHash,
            versionId: body.agent.versionId,
            id: body.agent.id,
          }
        : null,
      triggerId: body.triggerId,
      invocationId: body.invocationId,
      principalId: body.principalId,
      origin: body.origin,
      siteId: body.siteId,
      schemaVersion: body.schemaVersion,
    };
    const built = npBuildAgentRunAdmissionCanonicalBytes(body);
    expect(decoder.decode(built.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-run-admission.v1\0${decoder.decode(built.canonicalJsonUtf8)}`,
    );
    expect(await npDigestAgentRunAdmissionCanonical(body)).toBe(goldenDigest);
    expect(await npDigestAgentRunAdmissionCanonical(reordered)).toBe(goldenDigest);
    expect(
      await npDigestAgentRunAdmissionCanonical(
        runAdmission({ goal: "Assess one different bounded Agent abuse signal" }),
      ),
    ).not.toBe(goldenDigest);
  });
});
