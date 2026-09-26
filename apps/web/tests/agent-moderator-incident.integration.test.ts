import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentFeedback,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSiteMemberships } from "../../../packages/core/src/db/schema/system.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import {
  npDetectAgentRepeatedLinkSpamV1,
  npAgentModeratorWindowStartedAtV1,
} from "../../../packages/core/src/agent/moderator-detector.js";
import type { NpAgentModeratorFactV1 } from "../../../packages/core/src/agent-contract/moderator-contract.js";
import type { NpAgentIncidentFeedbackInputV1 } from "../../../packages/core/src/agent-contract/incident-feedback-contract.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
const windowStartedAt = npAgentModeratorWindowStartedAtV1(
  new Date(Date.now() - 600000).toISOString(),
);
const settings = {
  recipeId: "moderator.repeated-link-spam" as const,
  recipeVersion: 1 as const,
  collectionSlugs: ["posts"],
  windowSeconds: 600 as const,
  minIndependentAccounts: 3,
  minItems: 5,
  automaticConfidenceBasisPoints: 9900,
};
const digest = `cj1:sha256:${"A".repeat(43)}`;
function facts(count = 5): NpAgentModeratorFactV1[] {
  return Array.from({ length: count }, () => {
    const documentId = randomUUID();
    return {
      schemaVersion: "np.agent-moderator-fact.v1",
      siteId,
      observedAt: windowStartedAt,
      subject: { kind: "document", collection: "posts", documentId },
      memberId: randomUUID(),
      targetVersionDigest: digest,
      domainHashes: ["a".repeat(64)],
      spamVerdict: "pass",
      profanityVerdict: "pass",
      evidence: {
        kind: "revision",
        collection: "posts",
        documentId,
        revisionId: randomUUID(),
        observedAt: windowStartedAt,
        digest: "a".repeat(64),
        excerpt: null,
      },
    };
  });
}
async function candidate(rows = facts()) {
  const [result] = await npDetectAgentRepeatedLinkSpamV1({
    siteId,
    windowStartedAt,
    settings,
    facts: rows,
  });
  if (!result) throw new Error("Fixture detector did not yield candidate");
  return result;
}
function command(
  signalId: string,
  expectedVersion: number,
  extra: Partial<NpAgentIncidentFeedbackInputV1> = {},
): NpAgentIncidentFeedbackInputV1 {
  return {
    schemaVersion: "np.agent-incident-feedback-input.v1",
    expectedVersion,
    signalId,
    label: "false-positive",
    supersedesId: null,
    idempotencyKey: randomUUID(),
    ...extra,
  };
}
describe.skipIf(skipIfNoTestDb())("Moderator incident write owner", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("serializes concurrent observation, exactly replays, correlates evidence growth and rolls back with its source transaction", async () => {
    const f = await fixture();
    const s = createAgentIncidentWriteServiceV1({ resolveEvidence: () => true });
    const initialFacts = facts();
    const first = await candidate(initialFacts);
    const results = await Promise.all([s.observe(first), s.observe(first), s.observe(first)]);
    expect(new Set(results.map((r) => r.incidentId)).size).toBe(1);
    expect(new Set(results.map((r) => r.signalId)).size).toBe(1);
    expect(results.filter((r) => r.disposition === "created")).toHaveLength(1);
    expect(await f.db.select().from(npAgentIncidentTimeline)).toHaveLength(1);
    const next = await s.observe(await candidate([...initialFacts, ...facts(1)]));
    expect(next.incidentId).toBe(results[0].incidentId);
    expect(next.disposition).toBe("correlated");
    expect(next.versionNumber).toBe(2);
    expect(await f.db.select().from(npAgentIncidentSignals)).toHaveLength(2);
    const rollback = await candidate(facts(7));
    await expect(
      f.db.transaction(async (tx) => {
        await s.observe(rollback, { transaction: tx as typeof f.db });
        throw new Error("source rollback");
      }),
    ).rejects.toThrow("source rollback");
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(2);
    expect(await f.db.select().from(npAgentIncidentTimeline)).toHaveLength(2);
  });
  it("rejects unvalidated/forged evidence and isolates resolver mutations", async () => {
    const f = await fixture(),
      value = await candidate();
    await expect(
      createAgentIncidentWriteServiceV1({ resolveEvidence: () => false }).observe(value),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_INVALID" });
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
    await expect(
      createAgentIncidentWriteServiceV1({ resolveEvidence: () => true }).observe({
        ...value,
        evidenceDigest: `cj1:sha256:${"B".repeat(43)}`,
      }),
    ).rejects.toThrow();
    const s = createAgentIncidentWriteServiceV1({
      resolveEvidence: ({ candidate: mutable }) => {
        mutable.canonicalEvidence.siteId = "draft-other";
        mutable.summary = "Changed by callback";
        return true;
      },
    });
    const saved = await s.observe(value);
    const [incident] = await f.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.id, saved.incidentId));
    expect(incident.siteId).toBe(siteId);
    expect(incident.summary).toBe(value.summary);
  });
  it("records immutable attributed feedback, replay and correction with current staff, item ACL and incident CAS", async () => {
    const f = await fixture();
    const s = createAgentIncidentWriteServiceV1({
      resolveEvidence: () => true,
      canRecordFeedback: () => true,
    });
    const observed = await s.observe(await candidate());
    const input = {
      siteId,
      incidentId: observed.incidentId,
      actor: f.actor.actor,
      command: command(observed.signalId, 1),
    };
    const initialFeedback = await Promise.all([s.feedback(input), s.feedback(input)]);
    const first = initialFeedback[0];
    expect(initialFeedback.filter((item) => !item.replayed)).toHaveLength(1);
    expect((await s.feedback(input)).replayed).toBe(true);
    const rows = await f.db.select().from(npAgentFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "false-positive",
      detectorId: "moderator.repeated-link-spam",
      detectorVersion: 1,
      recordedByUserId: f.actor.actor.user.id,
      policyHashes: [],
    });
    expect(rows[0].actorFingerprint).toMatch(/^cj1:sha256:/);
    await expect(
      s.feedback({ ...input, command: command(observed.signalId, 1) }),
    ).rejects.toMatchObject({ code: "INCIDENT_VERSION_CONFLICT" });
    await expect(
      s.feedback({ ...input, siteId: "draft-other", command: command(observed.signalId, 2) }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    const corrected = await s.feedback({
      ...input,
      command: command(observed.signalId, 2, { label: "confirmed-spam", supersedesId: rows[0].id }),
    });
    expect(corrected.output.versionNumber).toBe(3);
    expect(
      (await f.db.select().from(npAgentFeedback).where(eq(npAgentFeedback.id, rows[0].id)))[0]
        .label,
    ).toBe("false-positive");
    await expect(
      s.feedback({
        ...input,
        command: command(observed.signalId, 3, { supersedesId: rows[0].id }),
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_FEEDBACK_VERSION_CONFLICT" });
    await expect(
      createAgentIncidentWriteServiceV1({
        resolveEvidence: () => true,
        canRecordFeedback: () => false,
      }).feedback({ ...input, command: command(observed.signalId, 3) }),
    ).rejects.toMatchObject({ code: "INCIDENT_FEEDBACK_FORBIDDEN" });
    const invocations = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.operationId, "agents.incidents.feedback"));
    expect(invocations).toHaveLength(2);
    expect(first.resourceId).toBe(observed.incidentId);
    await f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(
        and(
          eq(npSiteMemberships.siteId, siteId),
          eq(npSiteMemberships.userId, f.actor.actor.user.id),
        ),
      );
    await expect(s.feedback(input)).rejects.toMatchObject({ code: "SITE_ACCESS_DENIED" });
    expect(await f.db.select().from(npAgentFeedback)).toHaveLength(2);
  });
});
