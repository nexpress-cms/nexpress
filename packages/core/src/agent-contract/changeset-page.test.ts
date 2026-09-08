import { describe, expect, it } from "vitest";
import { npAnalyzeAgentChangeSetProposalCanonical } from "./canonical-changeset.js";
import { npAnalyzeAgentChangeSetWire } from "./changeset-wire-contract.js";
import { npAnalyzeAgentCursorPageV1 } from "./wire-contract.js";
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
describe("ChangeSet bounded cursor-page depth", () => {
  it("preserves valid deep draft content through list pages using the explicit bounded depth", () => {
    const { proposal, wire } = fixture(25);
    expect(npAnalyzeAgentChangeSetProposalCanonical(proposal).ok).toBe(true);
    expect(npAnalyzeAgentChangeSetWire(wire).ok).toBe(true);
    const page = { schemaVersion: "np.agent-changesets.v1", items: [wire], nextCursor: null };
    const options = {
      schemaVersion: "np.agent-changesets.v1",
      analyzeItem: npAnalyzeAgentChangeSetWire,
      itemIssueRoot: "agent.changeset.wire",
      maximumBytes: 8 * 1024 * 1024,
    };
    expect(npAnalyzeAgentCursorPageV1(page, options).ok).toBe(false);
    expect(npAnalyzeAgentCursorPageV1(page, { ...options, maximumDepth: 64 })).toEqual({
      ok: true,
      value: page,
    });
  });
  it("retains item validation and hard maximum depth even when the page allows a larger envelope", () => {
    const { wire } = fixture(1);
    const options = {
      schemaVersion: "np.agent-changesets.v1",
      analyzeItem: npAnalyzeAgentChangeSetWire,
      itemIssueRoot: "agent.changeset.wire",
      maximumBytes: 8 * 1024 * 1024,
      maximumDepth: 64,
    };
    expect(
      npAnalyzeAgentCursorPageV1(
        {
          schemaVersion: "np.agent-changesets.v1",
          items: [{ ...wire, sealedPlanBody: { private: true } }],
          nextCursor: null,
        },
        options,
      ).ok,
    ).toBe(false);
    let nested: unknown = null;
    for (let i = 0; i < 70; i++) nested = { value: nested };
    expect(
      npAnalyzeAgentCursorPageV1(
        { schemaVersion: "test", items: [nested], nextCursor: null },
        {
          schemaVersion: "test",
          analyzeItem: (value: unknown) => ({ ok: true as const, value }),
          itemIssueRoot: "test",
          maximumDepth: 100,
        },
      ).ok,
    ).toBe(false);
  });
});
