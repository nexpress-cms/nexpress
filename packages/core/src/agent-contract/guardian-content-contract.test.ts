import { describe, expect, it } from "vitest";
import {
  npRequireAgentGuardianContentActivityV1,
  npRequireAgentGuardianContentEvidenceV1,
} from "./guardian-content-contract.js";
const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-10-18T00:01:00.000Z";
function activity() {
  return {
    schemaVersion: "np.agent-guardian-content-activity.v1",
    writeId: id,
    siteId: "default",
    collection: "posts",
    documentId: id,
    occurredAt: at,
    actor: { kind: "staff", userId: id },
    fact: { kind: "document-save", operation: "update", status: "draft", revision: null },
  };
}
describe("Guardian content source contracts", () => {
  it("retains a revisions-off save without inventing a revision and rejects private payload or false actor provenance", () => {
    expect(npRequireAgentGuardianContentActivityV1(activity()).fact).toMatchObject({
      revision: null,
    });
    const value = activity();
    for (const change of [
      { content: "private document" },
      { actor: { kind: "agent-principal", principalId: id } },
      { actor: { kind: "staff", userId: id, email: "private@example.test" } },
      { fact: { ...value.fact, snapshot: { secret: "private" } } },
      { fact: { ...value.fact, revision: { id, version: 1, status: "autosave", createdAt: at } } },
      { fact: { kind: "revision-autosave", revision: null } },
    ])
      expect(() => npRequireAgentGuardianContentActivityV1({ ...value, ...change })).toThrow();
    expect(
      npRequireAgentGuardianContentActivityV1({
        ...value,
        fact: {
          kind: "revision-autosave",
          revision: { id, version: 2, status: "autosave", createdAt: at },
        },
      }).fact.kind,
    ).toBe("revision-autosave");
  });
  it("keeps save, revision and distinct-account bounds separate and rejects invented totals or private identities", () => {
    const value = {
      schemaVersion: "np.agent-guardian-content-evidence.v1",
      signalId: id,
      detectorId: "guardian.content-churn",
      detectorVersion: 1,
      document: { collection: "posts", documentId: id },
      window: { startedAt: "2026-10-18T00:00:00.000Z", endedAt: at },
      basis: "committed-saves",
      observedCount: 5,
      distinctAccountCount: 3,
      countBasis: "at-least",
      sourceDigest: `cj1:sha256:${"A".repeat(43)}`,
    };
    expect(npRequireAgentGuardianContentEvidenceV1(value).basis).toBe("committed-saves");
    for (const change of [
      { observedCount: 6 },
      { distinctAccountCount: 2 },
      { countBasis: "total" },
      { actorIds: [id] },
      { basis: "persisted-revisions" },
      { window: { ...value.window, endedAt: "2026-10-18T00:10:00.000Z" } },
    ])
      expect(() => npRequireAgentGuardianContentEvidenceV1({ ...value, ...change })).toThrow();
    expect(
      npRequireAgentGuardianContentEvidenceV1({
        ...value,
        detectorId: "guardian.revision-volume",
        basis: "persisted-revisions",
        observedCount: 20,
        distinctAccountCount: 1,
      }).observedCount,
    ).toBe(20);
  });
});
