import { describe, expect, it } from "vitest";
import type {
  NpAgentModeratorFactV1,
  NpAgentModeratorSettingsV1,
} from "../agent-contract/moderator-contract.js";
import { npDetectAgentRepeatedLinkSpamV1 } from "./moderator-detector.js";
import {
  npMergeModeratorFloodTargetV1,
  npModeratorFloodCandidateV1,
  npModeratorFloodEvidenceBatchV1,
  npModeratorFloodTargetV1,
  npModeratorFloodWitnessV1,
} from "./moderator-flood-facts.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const start = "2026-10-15T00:00:00.000Z";
const domainHash = "a".repeat(64);
const settings: NpAgentModeratorSettingsV1 = {
  recipeId: "moderator.repeated-link-spam",
  recipeVersion: 1,
  collectionSlugs: ["posts"],
  windowSeconds: 600,
  minIndependentAccounts: 3,
  minItems: 5,
  automaticConfidenceBasisPoints: 9950,
};
const fact = (n: number, author = n % 3): NpAgentModeratorFactV1 => ({
  schemaVersion: "np.agent-moderator-fact.v1",
  siteId: "default",
  observedAt: start,
  subject: { kind: "comment", commentId: uuid(n), documentId: uuid(9000), collection: "posts" },
  memberId: uuid(1000 + author),
  targetVersionDigest: `cj1:sha256:${"A".repeat(43)}`,
  domainHashes: [domainHash],
  spamVerdict: "pass",
  profanityVerdict: "pass",
  evidence: {
    kind: "event",
    eventId: uuid(n + 20000),
    eventKind: "community.content.created",
    observedAt: start,
    digest: "b".repeat(64),
    excerpt: null,
  },
});

describe("bounded Moderator flood evidence", () => {
  it("covers every target across batches, including a short tail, without exceeding canonical evidence bounds", async () => {
    const facts = Array.from({ length: 201 }, (_, n) => fact(n + 1));
    let witness: NpAgentModeratorFactV1[] = [];
    for (const item of facts) witness = npModeratorFloodWitnessV1([...witness, item]);
    const covered = new Set<string>();
    let cursor = 0;
    while (cursor < facts.length) {
      const batch = npModeratorFloodEvidenceBatchV1({
        facts: facts.slice(cursor, cursor + 100),
        witness,
        settings,
      });
      expect(batch).not.toBeNull();
      if (!batch) throw new Error("Expected qualifying batch");
      expect(batch.consumed).toBeGreaterThan(0);
      const candidate = await npModeratorFloodCandidateV1({
        siteId: "default",
        windowStartedAt: start,
        domainHash,
        facts: batch.facts,
      });
      expect(candidate.facts.length).toBeLessThanOrEqual(100);
      expect(candidate.advisory).toBe(true);
      for (const item of candidate.facts) covered.add(npModeratorFloodTargetV1(item));
      cursor += batch.consumed;
    }
    expect(covered).toEqual(new Set(facts.map(npModeratorFloodTargetV1)));
  });
  it("retains independent authors arriving after a full same-author page and does not lose unconsumed targets", () => {
    const facts = [
      ...Array.from({ length: 130 }, (_, n) => fact(n + 1, 0)),
      fact(131, 1),
      fact(132, 2),
    ];
    let witness: NpAgentModeratorFactV1[] = [];
    for (const item of facts) witness = npModeratorFloodWitnessV1([...witness, item]);
    expect(new Set(witness.map((item) => item.memberId)).size).toBe(3);
    const batch = npModeratorFloodEvidenceBatchV1({
      facts: facts.slice(0, 100),
      witness,
      settings,
    });
    expect(batch?.consumed).toBe(98);
    expect(batch?.facts).toHaveLength(100);
    expect(new Set(batch?.facts.map((item) => item.memberId)).size).toBe(3);
    expect(
      npModeratorFloodEvidenceBatchV1({
        facts: facts.slice(0, 10),
        witness: facts.slice(0, 100),
        settings,
      }),
    ).toBeNull();
  });
  it("replaces a target across pages, rejects conflicting same-time facts, and produces ordinary detector bytes", async () => {
    const old = fact(1);
    const latest = {
      ...old,
      observedAt: "2026-10-15T00:00:01.000Z",
      evidence: { ...old.evidence, observedAt: "2026-10-15T00:00:01.000Z" },
    };
    expect(npMergeModeratorFloodTargetV1(old, latest)).toEqual(latest);
    expect(npMergeModeratorFloodTargetV1(latest, old)).toEqual(latest);
    expect(() =>
      npMergeModeratorFloodTargetV1(old, { ...old, domainHashes: ["c".repeat(64)] }),
    ).toThrow();
    const facts = Array.from({ length: 5 }, (_, n) => fact(n + 1));
    expect(
      await npModeratorFloodCandidateV1({
        siteId: "default",
        windowStartedAt: start,
        domainHash,
        facts,
      }),
    ).toEqual(
      (
        await npDetectAgentRepeatedLinkSpamV1({
          siteId: "default",
          windowStartedAt: start,
          settings,
          facts,
        })
      )[0],
    );
  });
});
