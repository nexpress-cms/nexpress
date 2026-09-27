import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { npRequireAgentIncidentStudioDetailV1 } from "../../../packages/core/src/agent-contract/incident-studio-contract.js";
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

const key = new Uint8Array(32).fill(71);
const query = {
  statuses: [],
  categories: [],
  severities: [],
  updatedAfter: null,
  limit: 1,
  cursor: null,
};
describe.skipIf(skipIfNoTestDb())("Incident staff Studio", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  async function setup() {
    const f = await fixture();
    let visible = true;
    const writer = createAgentIncidentWriteServiceV1({
      resolveEvidence: () => true,
      canRecordFeedback: () => visible,
    });
    const observed = await writer.observe(await candidate());
    const reader = createAgentIncidentServiceV1({
      cursorHmacKey: key,
      canReadIncident: () => false,
      canReadStaffIncident: () => visible,
    });
    const service = createAgentIncidentStudioServiceV1({
      reads: reader.staff,
      writer,
      cursorHmacKey: key,
    });
    const input = { siteId, actor: f.actor.actor, incidentId: observed.incidentId };
    return {
      f,
      writer,
      observed,
      reader,
      service,
      input,
      hide: () => {
        visible = false;
      },
    };
  }
  it("projects current immutable feedback, preserves replay/CAS, redacts private source and rejects lost visibility", async () => {
    const x = await setup();
    const detail = await x.service.get(x.input);
    expect(detail.signals.map((s) => s.id)).toEqual([x.observed.signalId]);
    expect(detail.timeline[0].kind).toBe("observed");
    expect(JSON.stringify(detail)).not.toContain("targetVersionDigest");
    expect(() =>
      npRequireAgentIncidentStudioDetailV1({
        ...detail,
        signals: [{ ...detail.signals[0], evidence: { private: true } }],
      }),
    ).toThrow();
    const request = { ...x.input, command: command(x.observed.signalId, 1) };
    await x.service.feedback(request);
    expect((await x.service.feedback(request)).replayed).toBe(true);
    const first = await x.service.get(x.input);
    expect(first.feedback).toHaveLength(1);
    expect(first.feedback[0].label).toBe("false-positive");
    await expect(
      x.service.feedback({ ...request, command: command(x.observed.signalId, 1) }),
    ).rejects.toMatchObject({ code: "INCIDENT_VERSION_CONFLICT" });
    await x.service.feedback({
      ...request,
      command: command(x.observed.signalId, 2, {
        label: "confirmed-spam",
        supersedesId: first.feedback[0].id,
      }),
    });
    const corrected = await x.service.get(x.input);
    expect(corrected.feedback).toHaveLength(1);
    expect(corrected.feedback[0]).toMatchObject({
      label: "confirmed-spam",
      supersedesId: first.feedback[0].id,
    });
    expect(corrected.incident.versionNumber).toBe(3);
    x.hide();
    await expect(x.service.get(x.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await expect(x.service.feedback(request)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
  });
  it("paginates a bounded timeline, binds continuation to incident generation and rejects tampered evidence/session", async () => {
    const x = await setup();
    await x.f.db.insert(npAgentIncidentTimeline).values(
      Array.from({ length: 52 }, (_, i) => ({
        siteId,
        incidentId: x.observed.incidentId,
        sequence: i + 2,
        kind: "human_note",
        sourceKind: "staff",
        sourceId: x.input.actor.user.id,
        sourceFingerprint: "fixture",
        summary: "private text is not projected",
        details: { secret: "private" },
        createdAt: new Date(),
      })),
    );
    const first = await x.service.get(x.input);
    expect(first.timeline).toHaveLength(50);
    expect(first.nextTimelineCursor).toBeTruthy();
    const next = await x.service.get({ ...x.input, cursor: first.nextTimelineCursor });
    expect(next.timeline).toHaveLength(3);
    expect(next.nextTimelineCursor).toBeNull();
    expect(JSON.stringify(first)).not.toContain("private text");
    await x.service.feedback({ ...x.input, command: command(x.observed.signalId, 1) });
    await expect(
      x.service.get({ ...x.input, cursor: first.nextTimelineCursor }),
    ).rejects.toMatchObject({ code: "INCIDENT_CURSOR_INVALID" });
    await x.f.db
      .update(npAgentSignals)
      .set({ evidenceDigest: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentSignals.id, x.observed.signalId));
    await expect(x.service.get(x.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await x.f.db
      .update(npSessions)
      .set({ accessExpiresAt: new Date(0) })
      .where(eq(npSessions.id, x.input.actor.sessionId));
    await expect(x.service.list({ ...x.input, query })).rejects.toMatchObject({
      code: "STAFF_AUTHORIZATION_REQUIRED",
    });
  });
  it("orders unresolved severity first, binds list filters and keeps hidden scans bounded", async () => {
    const x = await setup();
    const time = new Date();
    const [critical, closed] = await x.f.db
      .insert(npAgentIncidents)
      .values([
        {
          siteId,
          category: "availability",
          severity: "critical",
          status: "open",
          fingerprint: randomUUID(),
          title: "Critical",
          summary: "Bounded fixture",
          firstObservedAt: time,
          lastObservedAt: time,
          createdAt: time,
          updatedAt: time,
        },
        {
          siteId,
          category: "availability",
          severity: "critical",
          status: "resolved",
          fingerprint: randomUUID(),
          title: "Closed",
          summary: "Bounded fixture",
          firstObservedAt: time,
          lastObservedAt: time,
          resolvedAt: time,
          resolutionCode: "FIXED",
          createdAt: time,
          updatedAt: time,
        },
      ])
      .returning();
    const first = await x.service.list({ ...x.input, query });
    expect(first.items[0].id).toBe(critical.id);
    const second = await x.service.list({
      ...x.input,
      query: { ...query, cursor: first.nextCursor },
    });
    expect(second.items[0].id).toBe(x.observed.incidentId);
    const third = await x.service.list({
      ...x.input,
      query: { ...query, cursor: second.nextCursor },
    });
    expect(third.items[0].id).toBe(closed.id);
    await expect(
      x.service.list({ ...x.input, query: { ...query, limit: 2, cursor: first.nextCursor } }),
    ).rejects.toMatchObject({ code: "INCIDENT_CURSOR_INVALID" });
    x.hide();
    const hidden = await x.service.list({ ...x.input, query });
    expect(hidden.items).toEqual([]);
    expect(hidden.nextCursor).toBeTruthy();
    const disabled = createAgentIncidentServiceV1({
      cursorHmacKey: key,
      canReadIncident: () => true,
    });
    await expect(disabled.staff.get({ incidentId: critical.id }, x.input)).rejects.toMatchObject({
      code: "INCIDENT_FORBIDDEN",
    });
  });
  it("does not advertise a writer with feedback disabled or return a row changed after list selection", async () => {
    const x = await setup();
    const disabled = createAgentIncidentStudioServiceV1({
      reads: x.reader.staff,
      writer: createAgentIncidentWriteServiceV1({ resolveEvidence: () => true }),
      cursorHmacKey: key,
    });
    expect((await disabled.get(x.input)).feedbackAvailable).toBe(false);
    let changed = false;
    const racing = createAgentIncidentStudioServiceV1({
      cursorHmacKey: key,
      reads: {
        ...x.reader.staff,
        get: async (input, context) => {
          if (!changed) {
            changed = true;
            await x.f.db
              .update(npAgentIncidents)
              .set({
                status: "resolved",
                versionNumber: 2,
                resolvedAt: new Date(),
                resolutionCode: "FIXED",
              })
              .where(eq(npAgentIncidents.id, input.incidentId));
          }
          return x.reader.staff.get(input, context);
        },
      },
    });
    expect(
      (await racing.list({ ...x.input, query: { ...query, statuses: ["open"] } })).items,
    ).toEqual([]);
  });
});
