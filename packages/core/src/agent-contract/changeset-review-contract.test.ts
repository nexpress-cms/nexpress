import { describe, expect, it } from "vitest";
import { npRequireAgentChangeSetReviewV1 } from "./changeset-review-contract.js";
const id = "11111111-1111-4111-8111-111111111111",
  hash = `cj1:sha256:${"a".repeat(43)}`;
function fixture(n: number) {
  let nested: unknown = "leaf";
  for (let i = 0; i < n; i++) nested = { value: nested };
  const operation = {
    clientOperationId: "op",
    reason: null,
    kind: "document",
    operation: "create",
    resource: { collection: "posts", documentId: null },
    base: null,
    input: { document: { data: nested }, targetStatus: "draft" },
  };
  const canonicalResourceKey = { kind: "document", collection: "posts", documentId: id };
  const proposal = {
    schemaVersion: "np.agent-changeset-proposal.v1",
    siteId: "default",
    changeSetId: id,
    draftVersion: 1,
    title: "Draft",
    summary: null,
    operations: [{ ordinal: 1, operation, canonicalResourceKey }],
  };
  const wire = {
    schemaVersion: "np.agent-changeset.v1",
    id,
    siteId: "default",
    title: "Draft",
    summary: null,
    state: "draft",
    actor: { id, kind: "staff", name: "Staff" },
    agentId: null,
    agentVersionId: null,
    agentConfigHash: null,
    runId: null,
    planHash: null,
    baseFingerprint: null,
    draftVersion: 1,
    draftHash: hash,
    risk: null,
    operations: [
      {
        ordinal: 1,
        operation,
        canonicalResourceKey,
        beforeHash: null,
        afterHash: null,
        state: "draft",
        issues: [],
        resultDigest: null,
      },
    ],
    validation: null,
    preview: null,
    approval: null,
    schedule: null,
    execution: null,
    verification: null,
    rollback: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
  };
  return { proposal, wire };
}
function review() {
  return {
    schemaVersion: "np.agent-changeset-review.v1",
    executionDetail: null,
    executionActions: [],
    changeSet: fixture(0).wire,
    requiredStaffCapabilities: ["content.author"],
    operations: [
      {
        ordinal: 1,
        evidence: "available",
        fields: [
          {
            path: "title",
            before: { presence: "absent", value: null },
            after: { presence: "present", value: "<script>untrusted</script>" },
          },
        ],
      },
    ],
  };
}
describe("ChangeSet review projection", () => {
  it("preserves escaped-display data with exact operation coverage", () => {
    expect(npRequireAgentChangeSetReviewV1(review()).operations[0].fields[0].after.value).toBe(
      "<script>untrusted</script>",
    );
  });
  it("rejects unknown snapshots and hidden evidence payloads", () => {
    expect(() => npRequireAgentChangeSetReviewV1({ ...review(), beforeSnapshot: {} })).toThrow();
    const value = review();
    value.operations[0].evidence = "redacted";
    expect(() => npRequireAgentChangeSetReviewV1(value)).toThrow();
    value.operations[0].fields = [];
    expect(npRequireAgentChangeSetReviewV1(value).operations[0].evidence).toBe("redacted");
  });
  it("rejects missing/duplicate operation or field identity and unavailable values", () => {
    const value = review();
    value.operations[0].fields.push(value.operations[0].fields[0]);
    expect(() => npRequireAgentChangeSetReviewV1(value)).toThrow();
    expect(() => npRequireAgentChangeSetReviewV1({ ...review(), operations: [] })).toThrow();
    const hidden = review();
    hidden.operations[0].fields[0].after.presence = "redacted";
    expect(() => npRequireAgentChangeSetReviewV1(hidden)).toThrow();
  });
  it("does not invoke hostile getters", () => {
    let called = false;
    const value = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        called = true;
        return "np.agent-changeset-review.v1";
      },
    });
    expect(() => npRequireAgentChangeSetReviewV1(value)).toThrow();
    expect(called).toBe(false);
  });
});
