import { describe, expect, it, vi } from "vitest";
import {
  npProjectAgentChangeSetReviewOperationV1,
  npProjectAgentRollbackReviewOperationV1,
} from "./changeset-review.js";
import type {
  NpAgentChangeSetOperationInput,
  NpAgentRollbackChangeSetPlanOperationCanonicalV1,
  NpAgentChangeSetSnapshotCanonicalV1,
} from "../agent-contract/types.js";
vi.mock("../collections/registry.js", () => ({
  getCollectionConfig: () => ({
    fields: [
      { name: "title", type: "text" },
      {
        name: "nested",
        type: "group",
        fields: [
          { name: "visible", type: "text" },
          { name: "private", type: "text", hidden: true },
        ],
      },
      { name: "serverOnly", type: "text", admin: { readOnly: true } },
    ],
  }),
}));
const digest = `cj1:sha256:${"a".repeat(43)}`;
const operation: NpAgentChangeSetOperationInput = {
  kind: "document",
  operation: "update",
  clientOperationId: "update",
  reason: null,
  resource: { collection: "posts", documentId: "11111111-1111-4111-8111-111111111111" },
  base: { version: "1", digest },
  input: {
    patch: {
      title: "After",
      nested: { visible: "new", private: "after-secret" },
      serverOnly: "after-internal",
    },
    targetStatus: null,
  },
};
const snapshot: NpAgentChangeSetSnapshotCanonicalV1 = {
  schemaVersion: "np.agent-changeset-snapshot.v1",
  siteId: "default",
  changeSetId: "22222222-2222-4222-8222-222222222222",
  operationOrdinal: 1,
  canonicalResourceKey: {
    kind: "document",
    collection: "posts",
    documentId: "11111111-1111-4111-8111-111111111111",
  },
  presence: "present",
  base: { version: "1", digest },
  value: {
    title: "Before",
    nested: { visible: "old", private: "before-secret" },
    serverOnly: "before-internal",
    createdBy: "staff-private-id",
    email: "private@example.test",
  },
};
describe("ChangeSet semantic review projection", () => {
  it("strips current hidden/read-only fields recursively and omits snapshot bookkeeping", () => {
    const review = npProjectAgentChangeSetReviewOperationV1({
      ordinal: 1,
      operation,
      snapshot,
      expired: false,
    });
    expect(review.fields.map((f) => f.path)).toEqual(["nested", "title"]);
    expect(review.fields[0]).toMatchObject({
      before: { value: { visible: "old" } },
      after: { value: { visible: "new" } },
    });
    expect(JSON.stringify(review)).not.toMatch(/secret|internal|staff-private|private@example/);
  });
  it("honestly represents absent and expired evidence", () => {
    expect(
      npProjectAgentChangeSetReviewOperationV1({
        ordinal: 1,
        operation,
        snapshot: null,
        expired: false,
      }),
    ).toEqual({ ordinal: 1, evidence: "not_validated", fields: [] });
    expect(
      npProjectAgentChangeSetReviewOperationV1({ ordinal: 1, operation, snapshot, expired: true }),
    ).toEqual({ ordinal: 1, evidence: "expired", fields: [] });
  });
  it("displays the same scheduled status and publishedAt field as the existing overlay", () => {
    const schedule: NpAgentChangeSetOperationInput = {
      ...operation,
      operation: "schedule",
      input: { publishAt: "2026-09-10T00:00:00.000Z" },
    };
    const review = npProjectAgentChangeSetReviewOperationV1({
      ordinal: 1,
      operation: schedule,
      snapshot: { ...snapshot, value: { status: "draft", publishedAt: null } },
      expired: false,
    });
    expect(review.fields).toEqual([
      {
        path: "publishedAt",
        before: { presence: "present", value: null },
        after: { presence: "present", value: schedule.input.publishAt },
      },
      {
        path: "status",
        before: { presence: "present", value: "draft" },
        after: { presence: "present", value: "scheduled" },
      },
    ]);
  });
});

it("projects full snapshot restoration through current editable fields only", () => {
  const rollback: NpAgentRollbackChangeSetPlanOperationCanonicalV1 = {
    ordinal: 1,
    originalOperationOrdinal: 1,
    canonicalResourceKey: snapshot.canonicalResourceKey,
    originalSnapshotHash: digest,
    expectedCurrentHash: digest,
    expectedCurrentVersion: "2",
    compensationOperation: { kind: "document", operation: "restore", resource: operation.resource },
    proposedAfterHash: digest,
    rollbackClass: "full",
    residualCodes: [],
  };
  const current = {
    ...snapshot,
    value: {
      title: "Applied",
      nested: { visible: "current", private: "secret" },
      createdBy: "private",
      serverOnly: "internal",
    },
  };
  const result = npProjectAgentRollbackReviewOperationV1({
    ordinal: 1,
    operation: rollback,
    snapshot,
    currentSnapshot: current,
    expired: false,
  });
  expect(result.fields.find((f) => f.path === "title")).toMatchObject({
    before: { value: "Applied" },
    after: { value: "Before" },
  });
  expect(JSON.stringify(result)).not.toMatch(/secret|internal|createdBy|private@example/);
  expect(
    npProjectAgentRollbackReviewOperationV1({
      ordinal: 1,
      operation: rollback,
      snapshot,
      currentSnapshot: null,
      expired: false,
    }).evidence,
  ).toBe("redacted");
  expect(
    npProjectAgentRollbackReviewOperationV1({
      ordinal: 1,
      operation: rollback,
      snapshot,
      currentSnapshot: current,
      expired: true,
    }).fields,
  ).toEqual([]);
});
