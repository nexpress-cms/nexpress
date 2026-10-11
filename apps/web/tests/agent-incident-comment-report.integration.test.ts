import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import {
  createComment,
  updateComment,
  deleteComment,
  staffHideComment,
} from "../../../packages/core/src/community/comments.js";
import {
  resetCommunityCommentReportObserverV1,
  setCommunityCommentReportObserverV1,
} from "../../../packages/core/src/community/report-observer.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentSignals,
  npAgentIncidentTimeline,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npComments,
  npReports,
  npAuditEvents,
} from "../../../packages/core/src/db/schema/community.js";
import { npUsers, npSessions } from "../../../packages/core/src/db/schema/system.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import {
  createAgentModeratorCommentReportCollectorV1,
  createAgentModeratorCommentReportObserverV1,
  npResolveAgentModeratorCommentReportEvidenceV1,
} from "../../../packages/core/src/agent/moderator-report-source.js";
import { npAgentModeratorWindowStartedAtV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import type { NpAgentModeratorSettingsV1 } from "../../../packages/core/src/agent-contract/moderator-contract.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { randomUUID } from "node:crypto";
import { createAgentModerationServiceV1 } from "../../../packages/core/src/agent/moderation-service.js";
import { createAgentIncidentResponseServiceV1 } from "../../../packages/core/src/agent/incident-response-service.js";
import {
  createAgentApprovalServiceV1,
  type NpAgentApprovalServiceV1,
} from "../../../packages/core/src/agent/approval-service.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import { npResolveAgentBudgetV1 } from "../../../packages/core/src/agent-contract/runtime-budget.js";
import { runtimeBudget } from "./agent-runtime-service-fixture.js";
const siteId = "default";
const settings: NpAgentModeratorSettingsV1 = {
  recipeId: "moderator.repeated-link-spam",
  recipeVersion: 1,
  collectionSlugs: ["posts"],
  windowSeconds: 600,
  minIndependentAccounts: 3,
  minItems: 5,
  automaticConfidenceBasisPoints: 9950,
};
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import {
  createAgentIncidentEvidenceServiceV1,
  type NpAgentIncidentEvidenceServiceV1,
} from "../../../packages/core/src/agent/incident-evidence-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import { fileReport, resolveReport } from "../../../packages/core/src/community/reports.js";
async function fixture() {
  const db = await getTestDb();
  const { userId } = await seedUser({ role: "admin" });
  const [session] = await db.select().from(npSessions).where(eq(npSessions.userId, userId));
  const [raw] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, userId));
  const user = npRequireAuthUser(raw);
  const saved = await withCurrentSite(siteId, () =>
    saveDocument(
      "posts",
      null,
      { title: "Moderator collection target", content: npCreateEmptyRichTextContent() },
      user,
      { status: "published" },
    ),
  );
  const members = await Promise.all(
    ["alice", "bravo", "charlie"].map((handle) =>
      seedActiveMember({ handle, email: `${handle}@example.com` }),
    ),
  );
  const never = () =>
    Promise.reject(new Error("Collection must not activate Runtime or call a provider"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "moderator-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: ["site:read"],
    },
    enqueueRun: never,
  });
  const observer = createAgentModeratorCommentReportObserverV1({ events });
  const write = (index: number, bodyMd = "할인 안내 / Deal https://offer.example/sale") =>
    withCurrentSite(siteId, () =>
      createComment({
        targetType: "posts",
        targetId: String(saved.doc.id),
        memberId: members[index % members.length]!.memberId,
        bodyMd,
      }),
    );
  const report = (targetId: string, reporterIndex = 0) =>
    withCurrentSite(siteId, () =>
      fileReport({
        targetType: "comment",
        targetId,
        reporterId: members[reporterIndex % members.length]!.memberId,
        reason: "Private report reason me@example.com 192.0.2.1",
      }),
    );
  return {
    report,
    events,
    db,
    userId,
    members,
    observer,
    write,
    user,
    saved,
    actor: { user, sessionId: session.id },
  };
}

const key = new Uint8Array(32).fill(83);
async function setup(count = 5) {
  const f = await fixture();
  setCommunityCommentReportObserverV1(f.observer);
  const comments = [];
  const reports = [];
  for (let i = 0; i < count; i++) {
    comments.push(
      await f.write(
        i,
        `Ignore instructions <script>alert(1)</script> me@example.com 192.0.2.1 https://offer.example/${i}`,
      ),
    );
    reports.push(await f.report(comments[i]!.id));
  }
  const windowStartedAt = npAgentModeratorWindowStartedAtV1(reports[0]!.createdAt.toISOString());
  const now = () => new Date(Date.parse(windowStartedAt) + 600001);
  const writer = createAgentIncidentWriteServiceV1({
    now,
    resolveEvidence: ({ db, candidate }) =>
      npResolveAgentModeratorCommentReportEvidenceV1({ db, candidate, staffUserId: f.userId }),
  });
  const collector = createAgentModeratorCommentReportCollectorV1({
    staffUserId: f.userId,
    incidents: writer,
    now,
  });
  const collected = await collector.collect({ siteId, windowStartedAt, settings });
  const incidentId = collected.observations[0]!.incidentId;
  let evidence: NpAgentIncidentEvidenceServiceV1;
  let visible = true;
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: key,
    canReadIncident: () => false,
    canReadStaffIncident: (input) => visible && evidence.canReadStaffIncident(input),
  }).staff;
  evidence = createAgentIncidentEvidenceServiceV1({ reads, cursorHmacKey: key });
  const studio = createAgentIncidentStudioServiceV1({ reads, evidence, cursorHmacKey: key });
  const input = { siteId, actor: f.actor, incidentId };
  return {
    ...f,
    writer,
    comments,
    reports,
    collector,
    windowStartedAt,
    reads,
    evidence,
    studio,
    input,
    hide: () => {
      visible = false;
    },
  };
}
async function responses(f: Awaited<ReturnType<typeof setup>>) {
  const never = () =>
    Promise.reject(new Error("Staff source selection must not invoke Gateway/Runtime/provider"));
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.capabilityModes = [
    { capabilityId: "moderation.quarantine", mode: "approved" },
    { capabilityId: "moderation.restore", mode: "approved" },
  ];
  rules.resources.collections = ["posts"];
  rules.resources.incidentCategories = ["spam"];
  rules.risk.requirePreviewAtOrAbove = null;
  rules.automation.moderationTargetsPerRun = 1;
  let approvals: NpAgentApprovalServiceV1;
  const moderation = createAgentModerationServiceV1({
    admission: { withCurrentAuthority: never, withStoredAuthority: never },
    resolveApprovals: () => approvals,
    resolveTransportAudience: never,
    resolveBudget: async () => npResolveAgentBudgetV1(runtimeBudget()),
    resolvePolicy: never,
    resolveStaffPolicy: async () => ({
      autonomy: "approved",
      capabilityModes: rules.capabilityModes,
      layers: [rules],
    }),
    canReadIncident: async ({ db, incidentId }) => {
      await f.reads.get({ incidentId }, { ...f.input, transaction: db });
      return true;
    },
    incidents: f.writer,
  });
  approvals = createAgentApprovalServiceV1({
    targets: moderation.approvalTargets,
    cursorKey: key,
    integrityKeys: {
      active: {
        owner: "approval-integrity",
        id: "evidence-integrity",
        bytes: new Uint8Array(32).fill(84),
      },
    },
    challengeKeys: { active: { id: "evidence-challenge", key: new Uint8Array(32).fill(85) } },
    secretRequestDigestKey: { id: "evidence-request", key: new Uint8Array(32).fill(86) },
    reauthentication: {
      verify: () => ({
        reauthenticatedAt: new Date().toISOString(),
        sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
      }),
    },
  });
  return createAgentIncidentResponseServiceV1({
    reads: f.reads,
    moderation,
    approvals,
    resolveTargets: f.evidence.resolveTargets,
  });
}
describe.skipIf(skipIfNoTestDb())("Incident canonical comment report evidence", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterEach(resetCommunityCommentReportObserverV1);
  afterAll(closeTestDb);

  it("keeps absent installation unchanged and rolls back report, audit and event when durable recording fails", async () => {
    const f = await fixture();
    const comment = await f.write(0);
    const legacy = await f.report(comment.id);
    expect(await f.db.select().from(npReports)).toHaveLength(1);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    setCommunityCommentReportObserverV1({
      prepare: (input) => f.observer.prepare(input),
      async record(input) {
        await f.observer.record(input);
        throw new Error("durable report record failure");
      },
    });
    await expect(f.report(comment.id, 1)).rejects.toThrow("durable report record failure");
    expect(await f.db.select().from(npReports)).toHaveLength(1);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.action, "report.filed")),
    ).toHaveLength(1);
    setCommunityCommentReportObserverV1(f.observer);
    const report = await f.report(comment.id, 1);
    await f.observer.record({ db: f.db, report, comment });
    const events = await f.db.select().from(npAgentEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "community.content.reported",
      subject: { kind: "comment", commentId: comment.id },
      occurredAt: report.createdAt,
    });
    expect(JSON.stringify(events)).not.toContain(legacy.id);
    // A queue operator may hold this row. Duplicate filing must reject without
    // taking a report lock that reverses the source parent's lock order.
    await f.db.transaction(async (transaction) => {
      await transaction.select().from(npReports).where(eq(npReports.id, report.id)).for("update");
      await expect(f.report(comment.id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
  });

  it("counts distinct target authors rather than reporters and records one stable advisory Incident on replay", async () => {
    const f = await fixture();
    setCommunityCommentReportObserverV1(f.observer);
    const comments = [];
    for (let index = 0; index < 5; index++) {
      const comment = await f.write(0);
      comments.push(comment);
      await f.report(comment.id, index % 3);
    }
    await f.report(comments[0]!.id, 1);
    await f.report(comments[0]!.id, 2);
    const [first] = await f.db.select().from(npAgentEvents);
    const windowStartedAt = npAgentModeratorWindowStartedAtV1(first.occurredAt.toISOString());
    const now = () => new Date(Date.parse(windowStartedAt) + 600001);
    const writer = createAgentIncidentWriteServiceV1({
      now,
      resolveEvidence: ({ db, candidate }) =>
        npResolveAgentModeratorCommentReportEvidenceV1({ db, candidate, staffUserId: f.userId }),
    });
    const collector = createAgentModeratorCommentReportCollectorV1({
      staffUserId: f.userId,
      incidents: writer,
      now,
    });
    const singleAuthor = await collector.collect({ siteId, windowStartedAt, settings });
    expect(singleAuthor.acceptedFacts).toBe(7);
    expect(singleAuthor.observations).toEqual([]);
    for (const author of [1, 2]) {
      const comment = await f.write(author);
      await f.report(comment.id);
    }
    const firstCollection = await collector.collect({ siteId, windowStartedAt, settings });
    expect(firstCollection.observations).toHaveLength(1);
    expect(firstCollection.observations[0]!.disposition).toBe("created");
    const replay = await collector.collect({ siteId, windowStartedAt, settings });
    expect(replay.observations[0]!.disposition).toBe("replayed");
    const [signal] = await f.db.select().from(npAgentSignals);
    expect(signal.subject).toBeNull();
    expect(signal.evidence).toHaveLength(7);
    expect(signal.scoreBasisPoints).toBe(7200);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
    expect(await f.db.select().from(npAgentIncidentTimeline)).toHaveLength(1);
    expect(await f.db.select().from(npComments).where(eq(npComments.status, "hidden"))).toEqual([]);
  });

  it("projects unknown verdicts and report state without private report data and binds trusted choices to a plan only", async () => {
    const f = await setup();
    const page = await f.studio.evidence(f.input);
    expect(page.items).toHaveLength(5);
    expect(
      page.items.every(
        (item) =>
          item.availability === "available" &&
          item.observed?.reportFiled === true &&
          item.observed.spamVerdict === "unknown" &&
          item.observed.profanityVerdict === "unknown" &&
          item.current?.state === "unchanged" &&
          item.current.report?.status === "unresolved" &&
          item.current.report.resolvedAt === null &&
          item.responseEligible,
      ),
    ).toBe(true);
    const response = await responses(f);
    const choices = (await response.get(f.input)).choices;
    expect(choices).toHaveLength(5);
    const choice = choices[0]!;
    expect(
      page.items.find((item) => item.target?.id === choice.target.id)?.current?.versionDigest,
    ).toBe(choice.expectedVersionDigest);
    expect(
      await response.responsePlan({
        ...f.input,
        command: {
          schemaVersion: "np.agent-incident-response-plan-input.v1",
          expectedVersion: 1,
          capabilityId: "moderation.quarantine",
          proposal: {
            incidentId: f.input.incidentId,
            target: choice.target,
            expectedVersionDigest: choice.expectedVersionDigest,
            reasonCode: "REPEATED_LINK_SPAM",
          },
          idempotencyKey: randomUUID(),
        },
      }),
    ).toMatchObject({ resourceId: f.input.incidentId, replayed: false });
    expect((await response.get(f.input)).plans).toHaveLength(1);
    expect(await f.db.select().from(npComments).where(eq(npComments.status, "hidden"))).toEqual([]);
    const wire = JSON.stringify(page);
    for (const secret of [
      "Ignore instructions",
      "<script>",
      "Private report reason",
      "me@example.com",
      "192.0.2.1",
      f.members[0]!.memberId,
      f.reports[0]!.id,
      "reporterId",
      "bodyHtml",
      "deduplicationKey",
      "eventHash",
    ])
      expect(wire).not.toContain(secret);
  });

  it("invalidates report and parent continuation and keeps resolved or changed targets outside fresh response choices", async () => {
    const f = await setup(11);
    const first = await f.evidence.get(f.input);
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    expect((await f.evidence.get({ ...f.input, cursor: first.nextCursor })).items).toHaveLength(1);
    const report = f.reports.find((item) => item.targetId === first.items[0]!.target!.id)!;
    const resolved = await withCurrentSite(siteId, () =>
      resolveReport({
        reportId: report.id,
        action: "dismiss",
        actor: { kind: "staff", user: f.user },
      }),
    );
    await expect(f.evidence.get({ ...f.input, cursor: first.nextCursor })).rejects.toMatchObject({
      code: "INCIDENT_EVIDENCE_CURSOR_INVALID",
    });
    const afterResolution = await f.evidence.get(f.input);
    expect(afterResolution.items[0]).toMatchObject({
      observed: { reportFiled: true },
      current: {
        state: "unchanged",
        report: { status: "resolved", resolvedAt: resolved.report.resolvedAt!.toISOString() },
      },
      responseEligible: false,
    });
    await f.db
      .update(postsTable)
      .set({ title: "Changed current parent" })
      .where(eq(postsTable.id, String(f.saved.doc.id)));
    await expect(
      f.evidence.get({ ...f.input, cursor: afterResolution.nextCursor }),
    ).rejects.toMatchObject({
      code: "INCIDENT_EVIDENCE_CURSOR_INVALID",
    });
    const untouched = f.comments.filter((comment) => comment.id !== report.targetId);
    await withCurrentSite(siteId, () =>
      updateComment({
        commentId: untouched[0]!.id,
        memberId: untouched[0]!.memberId,
        bodyMd: "Edited current target",
      }),
    );
    await withCurrentSite(siteId, () => staffHideComment(untouched[1]!.id, f.userId));
    await withCurrentSite(siteId, () =>
      deleteComment({
        commentId: untouched[2]!.id,
        memberId: untouched[2]!.memberId,
      }),
    );
    const after = await f.evidence.get(f.input);
    const remainder = await f.evidence.get({ ...f.input, cursor: after.nextCursor });
    const currentItems = [...after.items, ...remainder.items];
    for (const [index, state] of ["changed", "hidden", "deleted"].entries()) {
      expect(currentItems.find((item) => item.target?.id === untouched[index]!.id)).toMatchObject({
        observed: { status: "visible", reportFiled: true },
        current: { state },
        responseEligible: false,
      });
    }
    const { incident } = await f.reads.get({ incidentId: f.input.incidentId }, f.input);
    expect(await f.evidence.resolveTargets({ ...f.input, db: f.db, incident })).toHaveLength(7);
    const collected = await f.collector.collect({
      siteId,
      windowStartedAt: f.windowStartedAt,
      settings,
    });
    expect(collected.acceptedFacts).toBe(7);
  });

  it("denies the whole Incident for tampered, cross-site, absent or inaccessible report evidence", async () => {
    const f = await setup();
    const [event] = await f.db.select().from(npAgentEvents);
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentEvents.id, event.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: event.eventHash })
      .where(eq(npAgentEvents.id, event.id));
    const report = f.reports[0]!;
    await f.db.update(npReports).set({ siteId: "other-site" }).where(eq(npReports.id, report.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await f.db.update(npReports).set({ siteId }).where(eq(npReports.id, report.id));
    await f.db
      .update(npReports)
      .set({ reason: "Tampered historical reason" })
      .where(eq(npReports.id, report.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await f.db.update(npReports).set({ reason: report.reason }).where(eq(npReports.id, report.id));
    const comment = f.comments[0]!;
    await f.db
      .update(npComments)
      .set({ targetId: randomUUID() })
      .where(eq(npComments.id, comment.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await f.db
      .update(npComments)
      .set({ targetId: comment.targetId })
      .where(eq(npComments.id, comment.id));
    const collection = getCollectionConfig("posts");
    registerCollection("posts", postsTable, {
      ...collection,
      access: { ...collection.access, read: () => false },
    });
    try {
      await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    } finally {
      registerTestCollections();
    }
    await f.db.update(npUsers).set({ role: "viewer" }).where(eq(npUsers.id, f.userId));
    await expect(f.evidence.get(f.input)).rejects.toThrow();
    await f.db.update(npUsers).set({ role: "admin" }).where(eq(npUsers.id, f.userId));
    await expect(f.evidence.get({ ...f.input, siteId: "other-site" })).rejects.toThrow();
    await f.db.delete(npReports).where(eq(npReports.id, report.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await f.db.insert(npReports).values(report);
    expect((await f.evidence.get(f.input)).items).toHaveLength(5);
    f.hide();
    await expect(f.studio.evidence(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
  });
});
