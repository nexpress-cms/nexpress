import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAuthUser, NpCollectionConfig } from "../config/types.js";
import type { NpTransaction } from "../collections/pipeline.js";
import { npGetPersistedCollectionDocumentById } from "../collections/pipeline.js";
import { getCollectionConfig } from "../collections/registry.js";
import { npAssertSiteDocumentCreateQuota } from "../sites/quotas.js";
import { createAgentChangeSetResourceServiceV1 } from "./changeset-resources.js";
import { createAgentChangeSetValidationResourceServiceV1 } from "./changeset-validation-resources.js";
import type { NpAgentChangeSetProposalOperationCanonicalV1 } from "../agent-contract/types.js";
import { npRequireAgentChangeSetPlanCanonical } from "../agent-contract/canonical-changeset.js";

vi.mock("./changeset-resources.js", () => ({ createAgentChangeSetResourceServiceV1: vi.fn() }));
vi.mock("../collections/pipeline.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  npGetPersistedCollectionDocumentById: vi.fn(),
}));
vi.mock("../sites/quotas.js", () => ({ npAssertSiteDocumentCreateQuota: vi.fn() }));
vi.mock("../collections/registry.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getCollectionConfig: vi.fn(),
}));
const siteId = "default";
const changeSetId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const user = {
  id: changeSetId,
  role: "admin",
  email: "fixture@example.test",
  name: "Fixture",
} as NpAuthUser;
const now = new Date("2026-09-08T00:00:00Z");
const config: NpCollectionConfig = {
  slug: "articles",
  labels: { singular: "Article", plural: "Articles" },
  fields: [{ name: "title", type: "text", required: true }],
};
const entry: NpAgentChangeSetProposalOperationCanonicalV1 = {
  ordinal: 1,
  canonicalResourceKey: { kind: "document", collection: "articles", documentId },
  operation: {
    clientOperationId: "one",
    reason: null,
    kind: "document",
    operation: "create",
    resource: { collection: "articles", documentId: null },
    base: null,
    input: { document: { title: "Draft" }, targetStatus: "draft" },
  },
};
const txMethods = {
  select: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const tx = txMethods as unknown as NpTransaction;
const inspect = vi.fn();
function input() {
  return { tx, siteId, changeSetId, user, now, operations: [entry] };
}
describe("ChangeSet validation resource recipes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAgentChangeSetResourceServiceV1).mockReturnValue({
      inspectForValidation: inspect,
    } as unknown as ReturnType<typeof createAgentChangeSetResourceServiceV1>);
    inspect.mockImplementation((context) => ({
      operation: context.operation,
      canonicalResourceKey: context.canonicalResourceKey,
      requiredScopes: ["content:read"],
      document: { config, original: null, candidate: { title: "Draft" } },
    }));
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue(null);
    vi.mocked(getCollectionConfig).mockReturnValue(config);
    vi.mocked(npAssertSiteDocumentCreateQuota).mockResolvedValue();
  });
  it("retains exact media owner value conflicts when the collection has no timestamps", async () => {
    vi.mocked(getCollectionConfig).mockReturnValue({ ...config, timestamps: false });
    const mediaId = "33333333-3333-4333-8333-333333333333";
    const media = { id: mediaId, siteId, status: "ready", deletedAt: null, updatedAt: now };
    let selection = 0;
    txMethods.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selection++ % 2 === 0 ? [media] : []) }),
      }),
    }));
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue({
      id: documentId,
      cover: null,
    });
    const resource = { mediaId, collection: "articles", documentId, field: "cover" };
    const operation: NpAgentChangeSetProposalOperationCanonicalV1 = {
      ordinal: 1,
      canonicalResourceKey: { kind: "media_ref", ...resource },
      operation: {
        clientOperationId: "media",
        reason: null,
        kind: "media_ref",
        operation: "attach",
        resource,
        base: { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` },
        input: {},
      },
    };
    const service = createAgentChangeSetValidationResourceServiceV1();
    const before = await service.readBase({ ...input(), ...operation });
    expect(before.base?.version).toBe(`media:${now.toISOString()}:owner:untimestamped`);
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue({
      id: documentId,
      cover: mediaId,
    });
    const after = await service.readBase({ ...input(), ...operation });
    expect(after.base?.version).toBe(before.base?.version);
    expect(after.base?.digest).not.toBe(before.base?.digest);
    expect(after.snapshotHash).not.toBe(before.snapshotHash);
    if (operation.operation.kind !== "media_ref" || !before.base)
      throw new Error("Expected a present media reference base");
    await expect(
      service.validate({
        ...input(),
        operations: [{ ...operation, operation: { ...operation.operation, base: before.base } }],
      }),
    ).rejects.toMatchObject({ issues: [{ code: "BASE_CONFLICT" }] });
    expect(txMethods.insert).not.toHaveBeenCalled();
    expect(txMethods.update).not.toHaveBeenCalled();
    expect(txMethods.delete).not.toHaveBeenCalled();
  });
  it("locks absence, semantic proposal, snapshot, base and policy fingerprints with the existing sealed plan contract", async () => {
    const result = await createAgentChangeSetValidationResourceServiceV1().validate(input());
    expect(result).toMatchObject({
      requiredScopes: ["content:read"],
      requiredApplyScopes: ["content:draft", "content:publish"],
      risk: {
        level: "high",
        reasonCodes: ["ROLLBACK_PARTIAL"],
        approvalMode: "human",
        reversible: false,
      },
      snapshots: [{ presence: "absent", base: null, value: null }],
      operations: [{ beforeHash: null, rollbackClass: "residual", residualCodes: ["ROW_REMAINS"] }],
    });
    expect({
      after: result.operations[0].proposedAfterHash,
      snapshot: result.operations[0].snapshotHash,
      bases: result.baseFingerprint,
      policy: result.policyHashes,
    }).toMatchInlineSnapshot(`
      {
        "after": "cj1:sha256:JJUXh-TH7ByJEPz5QFpBtsB7uua1GHLpLGr42D2bjJ4",
        "bases": "cj1:sha256:ujrYHTkfJywoDLYXa99OaL-4jbucB4OV5r4M1-SWgVM",
        "policy": [
          "cj1:sha256:DoH8fb-OXyKr4BdVS-qbxvN8sHHuSNjUXXSzddWqSMk",
        ],
        "snapshot": "cj1:sha256:gumwV9VmrKLlIze13oyViG69qvEbrMInfu8qYAoo3I8",
      }
    `);
    expect(
      npRequireAgentChangeSetPlanCanonical({
        schemaVersion: "np.agent-changeset-plan.v1",
        planKind: "changeset",
        siteId,
        changeSetId,
        body: {
          draftVersion: 1,
          draftHash: result.baseFingerprint,
          validationGeneration: 1,
          baseFingerprint: result.baseFingerprint,
          operations: result.operations,
          risk: result.risk,
          requiredScopes: ["changeset:apply", ...result.requiredApplyScopes].sort(),
          requiredHumanCapabilities: ["content.author"],
          requiredHumanPredicates: [],
          policyHashes: result.policyHashes,
          expiresAt: "2026-09-09T00:00:00.000Z",
          rollbackWindowSeconds: 2592000,
        },
      }),
    ).toBeDefined();
    expect(inspect).toHaveBeenCalledWith(
      expect.objectContaining({ tx, reservedCreateDocumentIds: [documentId] }),
    );
    expect(npGetPersistedCollectionDocumentById).toHaveBeenCalledWith(
      "articles",
      documentId,
      siteId,
      { tx },
    );
    expect(npAssertSiteDocumentCreateQuota).toHaveBeenCalledWith(tx, siteId, 1);
    expect(txMethods.insert).not.toHaveBeenCalled();
    expect(txMethods.update).not.toHaveBeenCalled();
    expect(txMethods.delete).not.toHaveBeenCalled();
  });
  it("checks aggregate projected creates through the existing quota helper", async () => {
    const next = {
      ...entry,
      ordinal: 2,
      canonicalResourceKey: {
        kind: "document" as const,
        collection: "articles",
        documentId: "33333333-3333-4333-8333-333333333333",
      },
      operation: { ...structuredClone(entry.operation), clientOperationId: "two" },
    };
    vi.mocked(npAssertSiteDocumentCreateQuota).mockRejectedValue(
      new Error("private quota details"),
    );
    await expect(
      createAgentChangeSetValidationResourceServiceV1().validate({
        ...input(),
        operations: [entry, next],
      }),
    ).rejects.toMatchObject({
      issues: [{ code: "QUOTA_EXCEEDED", message: "The projected resource quota is exceeded." }],
    });
    expect(npAssertSiteDocumentCreateQuota).toHaveBeenCalledWith(tx, siteId, 2);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
  it("collapses opaque read failures without retaining their text", async () => {
    inspect.mockRejectedValue(new Error("private backend locator and contents"));
    await expect(
      createAgentChangeSetValidationResourceServiceV1().validate(input()),
    ).rejects.toMatchObject({
      message: "ChangeSet resource validation failed.",
      issues: [
        {
          code: "VALIDATION_FAILED",
          message: "Resource validation could not be completed.",
          evidenceRefs: [],
        },
      ],
    });
  });
  it("records a create collision as a bounded base conflict without exposing the row", async () => {
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue({
      id: documentId,
      private: "do not disclose",
    });
    await expect(
      createAgentChangeSetValidationResourceServiceV1().validate(input()),
    ).rejects.toMatchObject({ issues: [{ code: "BASE_CONFLICT", operationOrdinal: 1 }] });
  });
  it("rejects oversized before evidence rather than externalizing or truncating it", async () => {
    const original = {
      id: documentId,
      siteId,
      status: "draft",
      visibility: "public",
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      title: "x".repeat(270000),
    };
    inspect.mockImplementation((context) => ({
      operation: context.operation,
      canonicalResourceKey: context.canonicalResourceKey,
      requiredScopes: ["content:read", "content:draft"],
      document: { config, original, candidate: { title: "Next" } },
    }));
    const update = {
      ...entry,
      operation: {
        clientOperationId: "update",
        reason: null,
        kind: "document" as const,
        operation: "update" as const,
        resource: { collection: "articles", documentId },
        base: { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` },
        input: { patch: { title: "Next" }, targetStatus: null },
      },
    };
    await expect(
      createAgentChangeSetValidationResourceServiceV1().readBase({ ...input(), ...update }),
    ).rejects.toMatchObject({ issues: [{ code: "LIMIT_EXCEEDED" }] });
  });
  it("enforces the complete draft snapshot budget even when every individual snapshot fits", async () => {
    inspect.mockImplementation((context) => ({
      operation: context.operation,
      canonicalResourceKey: context.canonicalResourceKey,
      requiredScopes: ["content:read", "content:draft"],
      document: {
        config,
        original: {
          id: context.canonicalResourceKey.documentId,
          siteId,
          status: "draft",
          visibility: "public",
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          title: "x".repeat(200000),
        },
        candidate: { title: "Next" },
      },
    }));
    const service = createAgentChangeSetValidationResourceServiceV1();
    const operations: NpAgentChangeSetProposalOperationCanonicalV1[] = [];
    for (let index = 1; index <= 11; index++) {
      const id = `22222222-2222-4222-8222-${index.toString().padStart(12, "0")}`;
      const next: NpAgentChangeSetProposalOperationCanonicalV1 = {
        ordinal: index,
        canonicalResourceKey: { kind: "document", collection: "articles", documentId: id },
        operation: {
          clientOperationId: `update-${index.toString()}`,
          reason: null,
          kind: "document",
          operation: "update",
          resource: { collection: "articles", documentId: id },
          base: { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` },
          input: { patch: { title: "Next" }, targetStatus: null },
        },
      };
      const current = await service.readBase({ ...input(), ...next });
      if (
        next.operation.kind !== "document" ||
        next.operation.operation !== "update" ||
        !current.base
      )
        throw new Error("Expected current base");
      operations.push({ ...next, operation: { ...next.operation, base: current.base } });
    }
    await expect(service.validate({ ...input(), operations })).rejects.toMatchObject({
      issues: [{ code: "LIMIT_EXCEEDED", operationOrdinal: 11 }],
    });
  });
});
