import { describe, expect, it } from "vitest";
import { npAgentContractLimits } from "./contract.js";
import {
  npAgentChangeSetPlanCanonicalExcludedKeysV1,
  npAgentChangeSetPlanCanonicalIncludedKeysV1,
  npAgentInitialChangeSetPlanBodyIncludedKeysV1,
  npAgentInitialChangeSetPlanOperationIncludedKeysV1,
  npAgentRiskSummaryIncludedKeysV1,
  npAgentRollbackChangeSetPlanBodyIncludedKeysV1,
  npAgentRollbackChangeSetPlanOperationIncludedKeysV1,
  npAnalyzeAgentChangeSetPlanCanonical,
  npBuildAgentChangeSetPlanCanonicalBytes,
  npDigestAgentChangeSetPlanCanonical,
  npRequireAgentChangeSetPlanCanonical,
} from "./canonical-changeset.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentChangeSetPlanKinds,
  npAgentChangeSetRollbackClasses,
  npAgentHumanPredicates,
  npAgentRiskLevels,
  npAgentRiskReasonCodes,
  type NpAgentChangeSetOperationInput,
  type NpAgentChangeSetPlanCanonicalV1,
  type NpAgentInitialChangeSetPlanBodyV1,
  type NpAgentRollbackChangeSetPlanBodyV1,
} from "./types.js";

const decoder = new TextDecoder();
const changeSetId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const documentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const rollbackPlanId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd5";
const executionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd6";
const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const versionBase = { version: "v7", digest: digestA } as const;

function createOperation(index = 1, payload = "Hello"): NpAgentChangeSetOperationInput {
  return {
    clientOperationId: `create-${index.toString()}`,
    reason: null,
    kind: "document",
    operation: "create",
    resource: { collection: "articles", documentId: null },
    base: null,
    input: { document: { payload }, targetStatus: "draft" },
  };
}

function updateOperation(): NpAgentChangeSetOperationInput {
  return {
    clientOperationId: "restore-1",
    reason: "Restore the exact snapshot",
    kind: "document",
    operation: "update",
    resource: { collection: "articles", documentId },
    base: versionBase,
    input: { patch: { title: "Before" }, targetStatus: "draft" },
  };
}

function initialBody(
  overrides: Partial<NpAgentInitialChangeSetPlanBodyV1> = {},
): NpAgentInitialChangeSetPlanBodyV1 {
  return {
    draftVersion: 3,
    draftHash: digestA,
    validationGeneration: 2,
    baseFingerprint: digestB,
    operations: [
      {
        ordinal: 1,
        operation: createOperation(),
        canonicalResourceKey: { kind: "document", collection: "articles", documentId },
        beforeHash: null,
        proposedAfterHash: digestB,
        snapshotHash: digestA,
        rollbackClass: "residual",
        residualCodes: ["ROW_REMAINS"],
      },
    ],
    risk: {
      level: "high",
      reasonCodes: ["PUBLIC_WRITE", "ROLLBACK_PARTIAL"],
      approvalMode: "human",
      reversible: false,
    },
    requiredScopes: ["changeset:apply", "content:draft"],
    requiredHumanCapabilities: ["admin.manage", "content.author"],
    requiredHumanPredicates: ["is-super-admin"],
    policyHashes: [digestA, digestB],
    expiresAt: "2026-08-24T00:00:00.000Z",
    rollbackWindowSeconds: 2_592_000,
    ...overrides,
  };
}

function rollbackBody(
  overrides: Partial<NpAgentRollbackChangeSetPlanBodyV1> = {},
): NpAgentRollbackChangeSetPlanBodyV1 {
  return {
    rollbackPlanId,
    generation: 1,
    compensatesExecutionId: executionId,
    originalPlanHash: digestA,
    appliedResultDigest: digestB,
    baseFingerprint: digestA,
    operations: [
      {
        ordinal: 1,
        originalOperationOrdinal: 7,
        canonicalResourceKey: { kind: "document", collection: "articles", documentId },
        originalSnapshotHash: digestB,
        expectedCurrentHash: digestA,
        expectedCurrentVersion: "v7",
        compensationOperation: updateOperation(),
        proposedAfterHash: digestB,
        rollbackClass: "full",
        residualCodes: [],
      },
    ],
    risk: {
      level: "medium",
      reasonCodes: ["PUBLIC_WRITE"],
      approvalMode: "human",
      reversible: true,
    },
    requiredScopes: ["changeset:apply"],
    requiredHumanCapabilities: ["content.publish"],
    requiredHumanPredicates: [],
    policyHashes: [digestA],
    expiresAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

function initialPlan(
  body: NpAgentInitialChangeSetPlanBodyV1 = initialBody(),
): NpAgentChangeSetPlanCanonicalV1 {
  return {
    schemaVersion: "np.agent-changeset-plan.v1",
    planKind: "changeset",
    siteId: "docs-site",
    changeSetId,
    body,
  };
}

function rollbackPlan(
  body: NpAgentRollbackChangeSetPlanBodyV1 = rollbackBody(),
): NpAgentChangeSetPlanCanonicalV1 {
  return {
    schemaVersion: "np.agent-changeset-plan.v1",
    planKind: "rollback",
    siteId: "docs-site",
    changeSetId,
    body,
  };
}

describe("Agent ChangeSet plan canonical contract", () => {
  it("publishes the closed inventories and exact included/excluded fixtures", () => {
    expect(npAgentChangeSetPlanKinds).toEqual(["changeset", "rollback"]);
    expect(npAgentChangeSetRollbackClasses).toEqual(["full", "residual"]);
    expect(npAgentRiskLevels).toEqual(["low", "medium", "high", "critical"]);
    expect(npAgentRiskReasonCodes).toEqual([
      "PUBLIC_WRITE",
      "ARCHIVE",
      "PROTECTED_RESOURCE",
      "MULTI_RESOURCE",
      "OPERATION_VOLUME",
      "NAVIGATION_WRITE",
      "THEME_WRITE",
      "SETTING_WRITE",
      "NON_ATOMIC_SIDE_EFFECT",
      "ROLLBACK_PARTIAL",
    ]);
    expect(npAgentHumanPredicates).toEqual(["is-super-admin"]);
    expect(npAgentChangeSetPlanCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "planKind",
      "siteId",
      "changeSetId",
      "body",
    ]);
    expect(npAgentInitialChangeSetPlanBodyIncludedKeysV1).toEqual([
      "draftVersion",
      "draftHash",
      "validationGeneration",
      "baseFingerprint",
      "operations",
      "risk",
      "requiredScopes",
      "requiredHumanCapabilities",
      "requiredHumanPredicates",
      "policyHashes",
      "expiresAt",
      "rollbackWindowSeconds",
    ]);
    expect(npAgentRollbackChangeSetPlanBodyIncludedKeysV1).toEqual([
      "rollbackPlanId",
      "generation",
      "compensatesExecutionId",
      "originalPlanHash",
      "appliedResultDigest",
      "baseFingerprint",
      "operations",
      "risk",
      "requiredScopes",
      "requiredHumanCapabilities",
      "requiredHumanPredicates",
      "policyHashes",
      "expiresAt",
    ]);
    expect(npAgentInitialChangeSetPlanOperationIncludedKeysV1).toEqual([
      "ordinal",
      "operation",
      "canonicalResourceKey",
      "beforeHash",
      "proposedAfterHash",
      "snapshotHash",
      "rollbackClass",
      "residualCodes",
    ]);
    expect(npAgentRollbackChangeSetPlanOperationIncludedKeysV1).toEqual([
      "ordinal",
      "originalOperationOrdinal",
      "canonicalResourceKey",
      "originalSnapshotHash",
      "expectedCurrentHash",
      "expectedCurrentVersion",
      "compensationOperation",
      "proposedAfterHash",
      "rollbackClass",
      "residualCodes",
    ]);
    expect(npAgentRiskSummaryIncludedKeysV1).toEqual([
      "level",
      "reasonCodes",
      "approvalMode",
      "reversible",
    ]);
    expect(npAgentChangeSetPlanCanonicalExcludedKeysV1).toEqual([
      "planHash",
      "validationDigest",
      "title",
      "summary",
      "state",
      "preview",
      "previewDigest",
      "approval",
      "approvalId",
      "scheduledFor",
      "execution",
      "executionId",
      "executionResultDigest",
      "verification",
      "verificationDigest",
      "rollback",
      "rollbackEligibleUntil",
      "appliedAt",
      "verifiedAt",
      "rolledBackAt",
      "updatedAt",
    ]);
  });

  it("accepts, clones, and preserves both exact discriminated branches", () => {
    const initial = initialPlan();
    const rollback = rollbackPlan();
    const parsedInitial = npRequireAgentChangeSetPlanCanonical(initial);
    const parsedRollback = npRequireAgentChangeSetPlanCanonical(rollback);
    expect(parsedInitial).toEqual(initial);
    expect(parsedRollback).toEqual(rollback);
    expect(parsedInitial).not.toBe(initial);
    expect(parsedRollback).not.toBe(rollback);
    expect(parsedInitial.body).not.toBe(initial.body);
    expect(parsedRollback.body).not.toBe(rollback.body);
  });

  it("uses planKind to select one exact body and excludes mutable projections", () => {
    const invalid = [
      { ...initialPlan(), planHash: digestA },
      { ...rollbackPlan(), approvalId: rollbackPlanId },
      { ...initialPlan(), planKind: "unknown" },
      { ...initialPlan(), planKind: "rollback" },
      { ...rollbackPlan(), planKind: "changeset" },
      {
        ...initialPlan(),
        body: { ...initialBody(), rollbackPlanId },
      },
      {
        ...rollbackPlan(),
        body: { ...rollbackBody(), rollbackWindowSeconds: 60 },
      },
      {
        ...initialPlan(),
        body: { ...initialBody(), risk: { ...initialBody().risk, state: "ready" } },
      },
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentChangeSetPlanCanonical(value).ok).toBe(false);
    }
  });

  it("enforces operation identity, digest fields, create nullability, and rollback class", () => {
    const initialOperation = initialBody().operations[0];
    const rollbackOperation = rollbackBody().operations[0];
    const nonCreate = updateOperation();
    const invalid = [
      initialPlan(
        initialBody({
          operations: [{ ...initialOperation, beforeHash: "sha256:bad" }],
        }),
      ),
      initialPlan(
        initialBody({
          operations: [{ ...initialOperation, rollbackClass: "full" }],
        }),
      ),
      initialPlan(
        initialBody({
          operations: [
            {
              ...initialOperation,
              operation: nonCreate,
              beforeHash: null,
            },
          ],
        }),
      ),
      initialPlan(
        initialBody({
          operations: [
            {
              ...initialOperation,
              canonicalResourceKey: {
                kind: "document",
                collection: "other",
                documentId,
              },
            },
          ],
        }),
      ),
      rollbackPlan(
        rollbackBody({
          operations: [
            {
              ...rollbackOperation,
              canonicalResourceKey: {
                kind: "document",
                collection: "other",
                documentId,
              },
            },
          ],
        }),
      ),
      rollbackPlan(
        rollbackBody({
          operations: [{ ...rollbackOperation, expectedCurrentVersion: "contains space" }],
        }),
      ),
      rollbackPlan(
        rollbackBody({
          operations: [{ ...rollbackOperation, rollbackClass: "residual", residualCodes: [] }],
        }),
      ),
      rollbackPlan(
        rollbackBody({
          operations: [{ ...rollbackOperation, rollbackClass: "unavailable" as "full" }],
        }),
      ),
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentChangeSetPlanCanonical(value).ok).toBe(false);
    }
  });

  it("requires sorted operation and set arrays plus unique rollback source ordinals", () => {
    const first = rollbackBody().operations[0];
    const second = structuredClone(first);
    second.ordinal = 2;
    second.originalOperationOrdinal = 8;
    expect(
      npAnalyzeAgentChangeSetPlanCanonical(
        rollbackPlan(rollbackBody({ operations: [first, second] })),
      ).ok,
    ).toBe(true);

    const invalid = [
      rollbackPlan(rollbackBody({ operations: [second, first] })),
      rollbackPlan(
        rollbackBody({ operations: [first, { ...second, originalOperationOrdinal: 7 }] }),
      ),
      initialPlan(initialBody({ requiredScopes: ["content:draft", "changeset:apply"] })),
      initialPlan(initialBody({ requiredHumanCapabilities: ["content.author", "content.author"] })),
      initialPlan(initialBody({ requiredHumanPredicates: ["is-super-admin", "is-super-admin"] })),
      initialPlan(initialBody({ policyHashes: [digestB, digestA] })),
      initialPlan(
        initialBody({
          operations: [
            { ...initialBody().operations[0], residualCodes: ["ROW_REMAINS", "ROW_REMAINS"] },
          ],
        }),
      ),
      initialPlan(
        initialBody({
          risk: {
            ...initialBody().risk,
            reasonCodes: ["ROLLBACK_PARTIAL", "PUBLIC_WRITE"],
          },
        }),
      ),
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentChangeSetPlanCanonical(value).ok).toBe(false);
    }
  });

  it("binds residual rollback to visible risk and enforces duration/generation bounds", () => {
    expect(
      npAnalyzeAgentChangeSetPlanCanonical(initialPlan(initialBody({ rollbackWindowSeconds: 60 })))
        .ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentChangeSetPlanCanonical(
        initialPlan(initialBody({ rollbackWindowSeconds: 7_776_000 })),
      ).ok,
    ).toBe(true);

    const invalid = [
      initialPlan(initialBody({ rollbackWindowSeconds: 59 })),
      initialPlan(initialBody({ rollbackWindowSeconds: 7_776_001 })),
      initialPlan(initialBody({ validationGeneration: 0 })),
      rollbackPlan(rollbackBody({ generation: 0 })),
      initialPlan(initialBody({ risk: { ...initialBody().risk, reversible: true } })),
      initialPlan(
        initialBody({
          risk: { ...initialBody().risk, reasonCodes: ["PUBLIC_WRITE"] },
        }),
      ),
      initialPlan(
        initialBody({ risk: { ...initialBody().risk, approvalMode: "policy" as "human" } }),
      ),
      initialPlan(initialBody({ risk: { ...initialBody().risk, level: "destructive" as "high" } })),
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentChangeSetPlanCanonical(value).ok).toBe(false);
    }
  });

  it("enforces the 500-operation/64-collection and exact 4 MiB boundaries", () => {
    const operations = Array.from(
      { length: npAgentContractLimits.changeSetOperations },
      (_, index) => ({
        ...initialBody().operations[0],
        ordinal: index + 1,
        operation: createOperation(index),
        canonicalResourceKey: {
          kind: "document" as const,
          collection: "articles",
          documentId,
        },
      }),
    );
    expect(npAnalyzeAgentChangeSetPlanCanonical(initialPlan(initialBody({ operations }))).ok).toBe(
      true,
    );
    expect(
      npAnalyzeAgentChangeSetPlanCanonical(
        initialPlan(
          initialBody({
            operations: [...operations, { ...operations[0], ordinal: operations.length + 1 }],
          }),
        ),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentChangeSetPlanCanonical(
        initialPlan(
          initialBody({
            operations: operations.slice(0, 65).map((entry, index) => ({
              ...entry,
              operation: {
                ...entry.operation,
                resource: { collection: `articles-${index.toString()}`, documentId: null },
              } as NpAgentChangeSetOperationInput,
              canonicalResourceKey: {
                ...entry.canonicalResourceKey,
                collection: `articles-${index.toString()}`,
              },
            })),
          }),
        ),
      ).ok,
    ).toBe(false);

    const largeOperations = [0, 1, 2].map((index) => ({
      ...initialBody().operations[0],
      ordinal: index + 1,
      operation: createOperation(index, ""),
    }));
    const planAtLimit = initialPlan(initialBody({ operations: largeOperations }));
    let remaining =
      npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-plan.v1"] -
      npBuildAgentChangeSetPlanCanonicalBytes(planAtLimit).canonicalJsonUtf8.byteLength;
    for (const entry of largeOperations) {
      const length = Math.min(remaining, 1_999_999);
      if (entry.operation.kind !== "document" || entry.operation.operation !== "create") {
        throw new Error("unexpected operation branch");
      }
      entry.operation.input.document.payload = "x".repeat(length);
      remaining -= length;
    }
    expect(remaining).toBe(0);
    expect(npBuildAgentChangeSetPlanCanonicalBytes(planAtLimit).canonicalJsonUtf8).toHaveLength(
      npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-plan.v1"],
    );
    const final = largeOperations.at(-1)!.operation;
    if (final.kind !== "document" || final.operation !== "create") {
      throw new Error("unexpected operation branch");
    }
    const payload = final.input.document.payload;
    if (typeof payload !== "string") throw new Error("unexpected payload type");
    final.input.document.payload = `${payload}x`;
    expect(npAnalyzeAgentChangeSetPlanCanonical(planAtLimit).ok).toBe(false);
  });

  it("does not invoke accessors and rejects unsafe or non-I-JSON graphs", () => {
    let reads = 0;
    const proxied = new Proxy(initialPlan(), {
      get() {
        reads += 1;
        throw new Error("hostile get");
      },
    });
    expect(npRequireAgentChangeSetPlanCanonical(proxied)).toEqual(initialPlan());
    expect(reads).toBe(0);

    const accessor = initialPlan() as NpAgentChangeSetPlanCanonicalV1 & { planHash?: string };
    Object.defineProperty(accessor, "planHash", {
      enumerable: true,
      get() {
        reads += 1;
        return digestA;
      },
    });
    expect(npAnalyzeAgentChangeSetPlanCanonical(accessor).ok).toBe(false);
    expect(reads).toBe(0);

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const shared = { value: true };
    const sparse = Array(1);
    for (const value of [
      initialPlan(initialBody({ requiredScopes: sparse as never })),
      initialPlan(
        initialBody({
          operations: [
            {
              ...initialBody().operations[0],
              operation: createOperation(1, "\ud800"),
            },
          ],
        }),
      ),
      { ...initialPlan(), body: cycle },
      { ...initialPlan(), body: { ...initialBody(), extra: 1n } },
      { ...initialPlan(), body: { ...initialBody(), risk: shared }, approval: shared },
    ]) {
      expect(npAnalyzeAgentChangeSetPlanCanonical(value).ok).toBe(false);
    }
  });

  it("emits stable domain-separated initial and rollback golden vectors", async () => {
    const vectors = [
      {
        plan: initialPlan(),
        expectedDigest: "cj1:sha256:RYVtPxaIcJgfoikGYS4_IDBXo6gPyeEBcIdU81hV91Y",
      },
      {
        plan: rollbackPlan(),
        expectedDigest: "cj1:sha256:r15BTh4k-EPDfNHidWG6ZFZy_lrcK0ccu2jizLvfiL8",
      },
    ] as const;

    for (const vector of vectors) {
      const built = npBuildAgentChangeSetPlanCanonicalBytes(vector.plan);
      const json = decoder.decode(built.canonicalJsonUtf8);
      expect(built.purpose).toBe("np.agent-changeset-plan.v1");
      expect(JSON.parse(json)).toEqual(vector.plan);
      expect(decoder.decode(built.domainSeparatedUtf8)).toBe(
        `np.agent-canonical-json.v1\0np.agent-changeset-plan.v1\0${json}`,
      );
      expect(await npDigestAgentChangeSetPlanCanonical(vector.plan)).toBe(vector.expectedDigest);
    }
    expect(vectors[0].expectedDigest).not.toBe(vectors[1].expectedDigest);
  });
});
