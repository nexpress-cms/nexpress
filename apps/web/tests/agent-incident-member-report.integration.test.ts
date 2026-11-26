import { randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import { npRequireReportRow } from "../../../packages/core/src/community-contract/contract.js";
import {
  npDigestAgentEventCanonical,
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import { npRequireAgentModeratorSignalCandidateV1 } from "../../../packages/core/src/agent-contract/moderator-contract.js";
import type { NpAgentModeratorMemberReportCandidateV1 } from "../../../packages/core/src/agent-contract/moderator-member-report-contract.js";
import { createAgentIncidentMemberReportEvidenceServiceV1 } from "../../../packages/core/src/agent/incident-member-report-evidence-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { npAgentModeratorWindowStartedAtV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import {
  createAgentMemberReportIncidentWriteServiceV1,
  createAgentModeratorMemberReportCollectorV1,
  createAgentModeratorMemberReportObserverV1,
  npBuildAgentModeratorMemberReportEventV1,
  npResolveAgentModeratorMemberReportEvidenceV1,
} from "../../../packages/core/src/agent/moderator-member-report-source.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  resetCommunityMemberReportObserverV1,
  setCommunityMemberReportObserverV1,
} from "../../../packages/core/src/community/member-report-observer.js";
import { fileReport, resolveReport } from "../../../packages/core/src/community/reports.js";
import { issueBan, revokeBan } from "../../../packages/core/src/community/bans.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentEvents,
  npAgentFeedback,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npAuditEvents,
  npBans,
  npMemberRoles,
  npMembers,
  npReports,
} from "../../../packages/core/src/db/schema/community.js";
import {
  npSessions,
  npSiteMemberships,
  npSites,
  npUsers,
} from "../../../packages/core/src/db/schema/system.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
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

const siteId = "default";
const key = new Uint8Array(32).fill(91);

async function fixture(reporterCount = 3) {
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
  const target = await seedActiveMember({
    handle: `reported-${randomUUID().slice(0, 12)}`,
    email: `private-target-${randomUUID()}@example.com`,
    displayName: "Private reported member display name",
  });
  const reporters = await Promise.all(
    Array.from({ length: reporterCount }, () =>
      seedActiveMember({
        handle: `reporter-${randomUUID().slice(0, 12)}`,
        displayName: "Private reporter display name",
      }),
    ),
  );
  const never = () =>
    Promise.reject(
      new Error("Member report observation must not activate Runtime or invoke a provider"),
    );
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "member-report-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: ["site:read"],
    },
    enqueueRun: never,
  });
  const observer = createAgentModeratorMemberReportObserverV1({ events });
  const report = (reporterIndex = 0, requestSiteId = siteId, targetId = target.memberId) =>
    withCurrentSite(requestSiteId, () =>
      fileReport({
        targetType: "member",
        targetId,
        reporterId: reporters[reporterIndex]!.memberId,
        reason: "Private report claim private-reporter@example.com 192.0.2.1",
      }),
    );
  return {
    db,
    userId,
    user,
    actor: { user, sessionId: session.id },
    target,
    reporters,
    events,
    observer,
    report,
  };
}

async function setup(count = 3, options: { collect?: boolean } = {}) {
  const f = await fixture(count);
  setCommunityMemberReportObserverV1(f.observer);
  let reports: Awaited<ReturnType<typeof f.report>>[] = [];
  let windowStartedAt = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    reports = [];
    for (let index = 0; index < count; index++) reports.push(await f.report(index));
    windowStartedAt = npAgentModeratorWindowStartedAtV1(reports[0]!.createdAt.toISOString());
    if (
      reports.every(
        (report) =>
          npAgentModeratorWindowStartedAtV1(report.createdAt.toISOString()) === windowStartedAt,
      )
    )
      break;
    if (attempt === 2) throw new Error("Member report fixture crossed every bounded window retry");
    // Close discarded real filings through their owner. Their immutable Events
    // remain untouched and are ineligible for collection in the retry bucket.
    for (const report of reports)
      await withCurrentSite(siteId, () =>
        resolveReport({
          reportId: report.id,
          action: "dismiss",
          actor: { kind: "staff", user: f.user },
        }),
      );
  }
  const now = () => new Date(Date.parse(windowStartedAt) + 600001);
  const writer = createAgentMemberReportIncidentWriteServiceV1({
    now,
    resolveEvidence: ({ db, candidate }) =>
      npResolveAgentModeratorMemberReportEvidenceV1({ db, candidate, staffUserId: f.userId }),
  });
  const candidates: NpAgentModeratorMemberReportCandidateV1[] = [];
  const collector = createAgentModeratorMemberReportCollectorV1({
    staffUserId: f.userId,
    now,
    incidents: {
      observe(candidate, supplied) {
        candidates.push(structuredClone(candidate));
        return writer.observe(candidate, supplied);
      },
    },
  });
  const collected =
    options.collect === false
      ? { inspectedEvents: 0, acceptedFacts: 0, observations: [] }
      : await collector.collect({ siteId, windowStartedAt });
  const evidenceOwner: {
    current?: ReturnType<typeof createAgentIncidentMemberReportEvidenceServiceV1>;
  } = {};
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: key,
    canReadIncident: () => false,
    canReadStaffIncident: (input) => evidenceOwner.current?.canReadStaffIncident(input) ?? false,
  }).staff;
  const evidence = createAgentIncidentMemberReportEvidenceServiceV1({ reads, cursorHmacKey: key });
  evidenceOwner.current = evidence;
  const workflow = createAgentIncidentWorkflowServiceV1({
    reads,
    canReviewContainment: () => false,
  });
  const studio = createAgentIncidentStudioServiceV1({
    reads,
    memberReportEvidence: evidence,
    workflow,
    cursorHmacKey: key,
  });
  const input = {
    siteId,
    actor: f.actor,
    incidentId: collected.observations[0]?.incidentId ?? randomUUID(),
  };
  return {
    ...f,
    reports,
    windowStartedAt,
    now,
    writer,
    collector,
    candidates,
    collected,
    reads,
    evidence,
    studio,
    input,
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function retained(f: Pick<Fixture, "db">) {
  return {
    signals: await f.db.select().from(npAgentSignals),
    incidents: await f.db.select().from(npAgentIncidents),
    timeline: await f.db.select().from(npAgentIncidentTimeline),
  };
}
async function noEffects(f: Pick<Fixture, "db">) {
  for (const table of [
    npAgentActions,
    npAgentApprovals,
    npAgentContainments,
    npAgentInvocations,
    npAgentFeedback,
  ])
    expect(await f.db.select().from(table)).toEqual([]);
}

describe.skipIf(skipIfNoTestDb())("Incident actual member report evidence", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(resetCommunityMemberReportObserverV1);
  afterAll(closeTestDb);

  it("preserves uninstalled filing, rolls back recording failure and serializes duplicate report attempts", async () => {
    const f = await fixture();
    const legacy = await f.report();
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    setCommunityMemberReportObserverV1({
      prepare: f.observer.prepare,
      async record(input) {
        await f.observer.record(input);
        throw new Error("member report Event recording failed");
      },
    });
    await expect(f.report(1)).rejects.toThrow("member report Event recording failed");
    expect(await f.db.select().from(npReports)).toEqual([legacy]);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.action, "report.filed")),
    ).toHaveLength(1);
    setCommunityMemberReportObserverV1(f.observer);
    const attempts = await Promise.allSettled([f.report(1), f.report(1)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toMatchObject([
      { reason: { code: "CONFLICT" } },
    ]);
    const [event] = await f.db.select().from(npAgentEvents);
    const [rawReport] = await f.db
      .select()
      .from(npReports)
      .where(eq(npReports.reporterId, f.reporters[1]!.memberId));
    const report = npRequireReportRow(rawReport);
    const [member] = await f.db
      .select({ id: npMembers.id, status: npMembers.status, updatedAt: npMembers.updatedAt })
      .from(npMembers)
      .where(eq(npMembers.id, f.target.memberId));
    await f.observer.record({ db: f.db, report, member });
    expect(await f.db.select().from(npAgentEvents)).toEqual([event]);
    expect(event).toMatchObject({
      kind: "community.member.reported",
      sourceKind: "community",
      sourceComponent: "community.member-reports",
      subject: { kind: "member", memberId: f.target.memberId },
      payload: {
        kind: "community.member.reported",
        memberId: f.target.memberId,
        memberStatus: "active",
        claim: "unverified",
      },
      occurredAt: report.createdAt,
    });
    const eventWire = JSON.stringify(event);
    for (const privateValue of [
      "Private report claim",
      f.target.email,
      f.target.handle,
      "Private reported member display name",
      "192.0.2.1",
      "private-reporter@example.com",
    ])
      expect(eventWire).not.toContain(privateValue);
    await noEffects(f);
  });

  it("groups real filings into one bounded advisory review per exact member with no spam or response authority", async () => {
    const f = await setup();
    expect(f.collected).toMatchObject({ inspectedEvents: 3, acceptedFacts: 3 });
    expect(f.collected.observations).toHaveLength(1);
    const before = await retained(f);
    expect(before.signals).toHaveLength(1);
    expect(before.signals[0]).toMatchObject({
      category: "abuse",
      severity: "info",
      confidenceBasis: "external",
      scoreBasisPoints: null,
      subject: { kind: "member", memberId: f.target.memberId },
    });
    expect(before.signals[0].evidence).toHaveLength(3);
    expect(before.incidents[0]).toMatchObject({
      category: "abuse",
      severity: "info",
      primarySubject: { kind: "member", memberId: f.target.memberId },
    });
    expect(() => npRequireAgentModeratorSignalCandidateV1(f.candidates[0])).toThrow();
    const replay = await f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt });
    expect(replay.observations[0]).toMatchObject({
      incidentId: f.input.incidentId,
      disposition: "replayed",
    });
    expect(await retained(f)).toEqual(before);
    const detail = await f.studio.get(f.input);
    expect(detail.feedbackAvailable).toBe(false);
    expect(detail.feedback).toEqual([]);
    expect(detail.response).toBeNull();
    expect(detail.workflow?.availableTransitions).toContain("investigating");
    const memberReportEvidence = f.studio.memberReportEvidence;
    if (!memberReportEvidence)
      throw new Error("Expected explicitly installed member report evidence");
    const page = await memberReportEvidence(f.input);
    expect(page.items).toHaveLength(3);
    for (const item of page.items)
      expect(item).toMatchObject({
        availability: "available",
        target: { kind: "member", id: f.target.memberId },
        observed: { status: "active", claim: "unverified" },
        current: {
          state: "unchanged",
          status: "active",
          report: { status: "unresolved", resolvedAt: null },
        },
        responseEligible: false,
      });
    const wire = JSON.stringify({ page, detail });
    for (const privateValue of [
      "Private report claim",
      f.target.email,
      f.target.handle,
      "Private reported member display name",
      "Private reporter display name",
      ...f.reporters.map((reporter) => reporter.memberId),
      ...f.reports.map((report) => report.id),
      "reporterId",
      "eventHash",
      "deduplicationKey",
    ])
      expect(wire).not.toContain(privateValue);
    await noEffects(f);
  });

  it("binds continuation to all current report and member facts while retained claims stay read-only after drift", async () => {
    const f = await setup(12);
    const first = await f.evidence.get(f.input);
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const remainder = await f.evidence.get({ ...f.input, cursor: first.nextCursor });
    expect(remainder.items).toHaveLength(2);
    const [outsideFirstPageEvent] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, remainder.items[0]!.eventId));
    const resolved = f.reports.find(
      (report) =>
        outsideFirstPageEvent.actor?.kind === "member" &&
        outsideFirstPageEvent.actor.memberId === report.reporterId,
    )!;
    await withCurrentSite(siteId, () =>
      resolveReport({
        reportId: resolved.id,
        action: "dismiss",
        actor: { kind: "staff", user: f.user },
      }),
    );
    await expect(f.evidence.get({ ...f.input, cursor: first.nextCursor })).rejects.toMatchObject({
      code: "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID",
    });
    const afterResolution = await f.evidence.get(f.input);
    const afterResolutionRemainder = await f.evidence.get({
      ...f.input,
      cursor: afterResolution.nextCursor,
    });
    expect(
      [...afterResolution.items, ...afterResolutionRemainder.items].find(
        (item) => item.eventId === outsideFirstPageEvent.id,
      ),
    ).toMatchObject({
      current: { report: { status: "resolved", resolvedAt: expect.any(String) } },
      responseEligible: false,
    });
    const [member] = await f.db.select().from(npMembers).where(eq(npMembers.id, f.target.memberId));
    await f.db
      .update(npMembers)
      .set({
        displayName: "Actual edited private profile",
        updatedAt: new Date(member.updatedAt.getTime() + 1000),
      })
      .where(eq(npMembers.id, member.id));
    await expect(
      f.evidence.get({ ...f.input, cursor: afterResolution.nextCursor }),
    ).rejects.toMatchObject({ code: "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID" });
    const before = await retained(f);
    for (const status of ["active", "suspended", "deleted"] as const) {
      await f.db.update(npMembers).set({ status }).where(eq(npMembers.id, member.id));
      const page = await f.evidence.get(f.input);
      expect(
        page.items.every(
          (item) =>
            item.current?.state === "changed" &&
            item.current.status === status &&
            item.observed?.claim === "unverified" &&
            !item.responseEligible,
        ),
      ).toBe(true);
      expect(
        await f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt }),
      ).toMatchObject({ acceptedFacts: 0, observations: [] });
      expect(await retained(f)).toEqual(before);
    }
    await f.db.update(npAgentEvents).set({ expiresAt: new Date(Date.now() - 1) });
    expect((await f.evidence.get(f.input)).items).toHaveLength(10);
    await noEffects(f);
  });

  it("projects only current site restrictions and invalidates continuation on revocation or exact expiry", async () => {
    const f = await setup(12);
    let currentTime = new Date();
    const evidence = createAgentIncidentMemberReportEvidenceServiceV1({
      reads: f.reads,
      cursorHmacKey: key,
      now: () => currentTime,
    });
    const otherSiteId = "other-restriction-site";
    await f.db.insert(npSites).values({ id: otherSiteId, name: "Other restriction site" });
    const actor = { kind: "staff", user: f.user } as const;
    const siteBan = await withCurrentSite(siteId, () =>
      issueBan({ memberId: f.target.memberId, scopeType: "site", kind: "permanent", actor }),
    );
    const collectionBan = await withCurrentSite(siteId, () =>
      issueBan({
        memberId: f.target.memberId,
        scopeType: "collection",
        scopeId: "posts",
        kind: "temporary",
        expiresAt: new Date(currentTime.getTime() + 60000),
        reason: "Private restriction rationale",
        actor,
      }),
    );
    const categoryBan = await withCurrentSite(siteId, () =>
      issueBan({
        memberId: f.target.memberId,
        scopeType: "category",
        scopeId: randomUUID(),
        kind: "temporary",
        expiresAt: new Date(currentTime.getTime() + 2000),
        actor,
      }),
    );
    await withCurrentSite(siteId, () =>
      issueBan({
        memberId: f.target.memberId,
        scopeType: "collection",
        scopeId: "expired-scope",
        kind: "temporary",
        expiresAt: new Date(currentTime.getTime() - 1),
        actor,
      }),
    );
    await withCurrentSite(otherSiteId, () =>
      issueBan({ memberId: f.target.memberId, scopeType: "site", kind: "permanent", actor }),
    );
    await withCurrentSite(siteId, () =>
      issueBan({ memberId: f.reporters[0]!.memberId, scopeType: "site", kind: "permanent", actor }),
    );
    const first = await evidence.get(f.input);
    const context = first.items[0]!.current?.reviewContext;
    expect(context).toMatchObject({
      siteId,
      snapshotAt: currentTime.toISOString(),
      hasMoreRestrictions: false,
      canOpenMemberManagement: true,
    });
    expect(context?.activeRestrictions).toHaveLength(3);
    expect(context?.activeRestrictions).toEqual(
      expect.arrayContaining([
        { scopeType: "site", scopeId: null, kind: "permanent", expiresAt: null },
        {
          scopeType: "collection",
          scopeId: "posts",
          kind: "temporary",
          expiresAt: collectionBan.expiresAt?.toISOString(),
        },
      ]),
    );
    const wire = JSON.stringify(first);
    for (const privateValue of [
      "Private restriction rationale",
      "expired-scope",
      otherSiteId,
      siteBan.id,
      collectionBan.id,
      categoryBan.id,
      "byUserId",
      "reason",
    ])
      expect(wire).not.toContain(privateValue);
    currentTime = new Date(currentTime.getTime() + 1000);
    const continuation = await evidence.get({ ...f.input, cursor: first.nextCursor });
    expect(continuation.items).toHaveLength(2);
    expect(continuation.items[0]?.current?.reviewContext?.snapshotAt).toBe(context?.snapshotAt);
    await withCurrentSite(siteId, () => revokeBan({ banId: siteBan.id, actor }));
    await expect(evidence.get({ ...f.input, cursor: first.nextCursor })).rejects.toMatchObject({
      code: "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID",
    });
    const afterRevoke = await evidence.get(f.input);
    expect(afterRevoke.items[0]?.current?.reviewContext?.activeRestrictions).toHaveLength(2);
    currentTime = new Date(categoryBan.expiresAt!);
    await expect(
      evidence.get({ ...f.input, cursor: afterRevoke.nextCursor }),
    ).rejects.toMatchObject({
      code: "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID",
    });
    const afterExpiry = await evidence.get(f.input);
    expect(afterExpiry.items[0]?.current?.reviewContext?.activeRestrictions).toHaveLength(1);
    await withCurrentSite(siteId, () => revokeBan({ banId: collectionBan.id, actor }));
    const empty = await evidence.get(f.input);
    expect(empty.items[0]?.current?.reviewContext).toMatchObject({
      activeRestrictions: [],
      hasMoreRestrictions: false,
    });
    expect(empty.items.every((item) => item.responseEligible === false)).toBe(true);
    expect(JSON.stringify(empty)).not.toContain("revoked");
    expect(JSON.stringify(empty)).not.toContain("expired");
    await noEffects(f);
  });

  it("bounds active restrictions and independently withdraws management navigation when the live global role changes", async () => {
    const f = await setup(12);
    // Current site Agent review is still authorized by membership when the
    // global role loses the existing Member detail page's content.publish floor.
    await f.db.insert(npSiteMemberships).values({ siteId, userId: f.userId, role: "admin" });
    for (let index = 0; index < 26; index++)
      await withCurrentSite(siteId, () =>
        issueBan({
          memberId: f.target.memberId,
          scopeType: "collection",
          scopeId: `bounded-scope-${index}`,
          kind: "permanent",
          actor: { kind: "staff", user: f.user },
        }),
      );
    expect(await f.db.select().from(npBans)).toHaveLength(26);
    const first = await f.evidence.get(f.input);
    expect(first.items[0]?.current?.reviewContext).toMatchObject({
      hasMoreRestrictions: true,
      canOpenMemberManagement: true,
    });
    expect(first.items[0]?.current?.reviewContext?.activeRestrictions).toHaveLength(25);
    await f.db.update(npUsers).set({ role: "moderator" }).where(eq(npUsers.id, f.userId));
    await expect(f.evidence.get({ ...f.input, cursor: first.nextCursor })).rejects.toMatchObject({
      code: "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID",
    });
    const denied = await f.evidence.get(f.input);
    expect(denied.items[0]?.current?.reviewContext?.canOpenMemberManagement).toBe(false);
    expect(denied.items.every((item) => item.responseEligible === false)).toBe(true);
    await f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, f.userId)));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_FORBIDDEN" });
    await noEffects(f);
  });

  it("isolates site-specific filings for a global member and denies corrupted, missing or unauthorized sources", async () => {
    const f = await setup();
    const before = await retained(f);
    await f.db.insert(npSites).values({ id: "other-site", name: "Other member report site" });
    const otherReport = await f.report(0, "other-site");
    expect(otherReport.targetId).toBe(f.target.memberId);
    expect((await f.evidence.get(f.input)).items).toHaveLength(3);
    const [event] = await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.siteId, siteId));
    const report = f.reports[1]!;
    const deny = async () => {
      await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
      expect(await retained(f)).toEqual(before);
    };
    for (const change of [
      { siteId: "other-site" },
      { reason: "Tampered source allegation" },
      { targetId: randomUUID() },
      {
        resolvedAt: new Date(report.createdAt.getTime() - 1),
        resolution: "dismiss",
        resolvedByUserId: f.userId,
      },
    ]) {
      await f.db.update(npReports).set(change).where(eq(npReports.id, report.id));
      await deny();
      await f.db
        .update(npReports)
        .set({
          siteId,
          reason: report.reason,
          targetId: report.targetId,
          resolvedAt: report.resolvedAt,
          resolution: report.resolution,
          resolvedByUserId: report.resolvedByUserId,
        })
        .where(eq(npReports.id, report.id));
    }
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentEvents.id, event.id));
    await deny();
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: event.eventHash })
      .where(eq(npAgentEvents.id, event.id));
    const signal = before.signals[0]!;
    const substituted = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId: signal.siteId,
      detectorId: signal.detectorId,
      detectorVersion: signal.detectorVersion,
      category: signal.category,
      window: {
        startedAt: signal.windowStartedAt.toISOString(),
        endedAt: signal.windowEndedAt.toISOString(),
      },
      subject: signal.subject,
      evidence: signal.evidence.map((ref, index) =>
        index === 0 ? { ...ref, digest: "b".repeat(64) } : ref,
      ),
    });
    await f.db
      .update(npAgentSignals)
      .set({
        evidence: substituted.evidence,
        evidenceDigest: await npDigestAgentSignalEvidenceCanonical(substituted),
      })
      .where(eq(npAgentSignals.id, signal.id));
    await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await f.db
      .update(npAgentSignals)
      .set({ evidence: signal.evidence, evidenceDigest: signal.evidenceDigest })
      .where(eq(npAgentSignals.id, signal.id));
    expect(await retained(f)).toEqual(before);
    const query = {
      statuses: [],
      categories: [],
      severities: [],
      updatedAfter: null,
      limit: 10,
      cursor: null,
    };
    for (const change of [
      { scoreBasisPoints: 7000 },
      { confidenceBasis: "statistical" },
      { severity: "low" },
    ]) {
      await f.db.update(npAgentSignals).set(change).where(eq(npAgentSignals.id, signal.id));
      await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
      await expect(f.studio.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
      expect((await f.studio.list({ ...f.input, query })).items).toEqual([]);
      await f.db
        .update(npAgentSignals)
        .set({
          scoreBasisPoints: signal.scoreBasisPoints,
          confidenceBasis: signal.confidenceBasis,
          severity: signal.severity,
        })
        .where(eq(npAgentSignals.id, signal.id));
      expect(await retained(f)).toEqual(before);
    }
    await f.db.update(npUsers).set({ role: "viewer" }).where(eq(npUsers.id, f.userId));
    await expect(f.evidence.get(f.input)).rejects.toThrow();
    await f.db.update(npUsers).set({ role: "admin" }).where(eq(npUsers.id, f.userId));
    await expect(f.evidence.get({ ...f.input, siteId: "other-site" })).rejects.toThrow();
    expect((await f.evidence.get(f.input)).items).toHaveLength(3);
    await f.db.delete(npReports).where(eq(npReports.id, report.id));
    await deny();
    await f.db.insert(npReports).values(report);
    await f.db.delete(npAgentEvents).where(eq(npAgentEvents.id, event.id));
    await deny();
    await f.db.insert(npAgentEvents).values(event);
    await f.db.delete(npMembers).where(eq(npMembers.id, f.target.memberId));
    await deny();
  });

  it("checks the 100 raw Event bound before source inspection or retained writes", async () => {
    const f = await setup(1);
    const originalEvents = await f.db
      .select()
      .from(npAgentEvents)
      .where(
        and(
          eq(npAgentEvents.siteId, siteId),
          gte(npAgentEvents.occurredAt, new Date(f.windowStartedAt)),
          lt(npAgentEvents.occurredAt, new Date(Date.parse(f.windowStartedAt) + 600000)),
        ),
      );
    const source = originalEvents[0]!;
    const [member] = await f.db
      .select({ id: npMembers.id, status: npMembers.status, updatedAt: npMembers.updatedAt })
      .from(npMembers)
      .where(eq(npMembers.id, f.target.memberId));
    // Capacity-only canonical rows intentionally have no real report binding.
    // They exercise SQL preinspection limits, never accepted report evidence.
    const extra = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const canonical = npBuildAgentModeratorMemberReportEventV1({
          report: { ...f.reports[0]!, id: randomUUID() },
          member,
        });
        return {
          ...source,
          id: randomUUID(),
          deduplicationKey: canonical.deduplicationKey,
          eventHash: await npDigestAgentEventCanonical(canonical),
        };
      }),
    );
    await f.db.insert(npAgentEvents).values(extra.slice(0, -1));
    expect(await f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt })).toMatchObject(
      { inspectedEvents: 100, acceptedFacts: 1, observations: [expect.any(Object)] },
    );
    const before = await retained(f);
    await f.db.insert(npAgentEvents).values(extra[extra.length - 1]!);
    await expect(
      f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt }),
    ).rejects.toMatchObject({ code: "MODERATOR_SOURCE_LIMIT_REACHED" });
    expect(await retained(f)).toEqual(before);
  });

  it("collects the same global targets concurrently across sites with reversed filing chronology", async () => {
    const f = await fixture(1);
    const otherSiteId = "other-site";
    await f.db.insert(npSites).values({ id: otherSiteId, name: "Independent member report site" });
    await f.db
      .insert(npSiteMemberships)
      .values({ siteId: otherSiteId, userId: f.userId, role: "admin" });
    const otherTarget = await seedActiveMember({ handle: `reported-${randomUUID().slice(0, 12)}` });
    setCommunityMemberReportObserverV1(f.observer);
    let reports: Awaited<ReturnType<typeof f.report>>[] = [];
    let windowStartedAt = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      // Both sites report the same two accounts in opposite order. Their site
      // controls are independent; their current account rows are shared.
      reports = [
        await f.report(0, siteId, f.target.memberId),
        await f.report(0, siteId, otherTarget.memberId),
        await f.report(0, otherSiteId, otherTarget.memberId),
        await f.report(0, otherSiteId, f.target.memberId),
      ];
      windowStartedAt = npAgentModeratorWindowStartedAtV1(reports[0]!.createdAt.toISOString());
      if (
        reports.every(
          (report) =>
            npAgentModeratorWindowStartedAtV1(report.createdAt.toISOString()) === windowStartedAt,
        )
      )
        break;
      if (attempt === 2)
        throw new Error("Concurrent member report fixture crossed every window retry");
      for (const report of reports)
        await withCurrentSite(report.siteId, () =>
          resolveReport({
            reportId: report.id,
            action: "dismiss",
            actor: { kind: "staff", user: f.user },
          }),
        );
    }
    const now = () => new Date(Date.parse(windowStartedAt) + 600001);
    const writer = createAgentMemberReportIncidentWriteServiceV1({
      now,
      resolveEvidence: ({ db, candidate }) =>
        npResolveAgentModeratorMemberReportEvidenceV1({ db, candidate, staffUserId: f.userId }),
    });
    const collectors = [siteId, otherSiteId].map((requestSiteId) => ({
      siteId: requestSiteId,
      collector: createAgentModeratorMemberReportCollectorV1({
        staffUserId: f.userId,
        incidents: writer,
        now,
      }),
    }));
    const batches = await Promise.all(
      collectors.map(({ collector, siteId: requestSiteId }) =>
        collector.collect({ siteId: requestSiteId, windowStartedAt }),
      ),
    );
    for (const batch of batches)
      expect(batch).toMatchObject({
        inspectedEvents: 2,
        acceptedFacts: 2,
        observations: [expect.any(Object), expect.any(Object)],
      });
    const rows = await f.db.select().from(npAgentSignals);
    expect(rows).toHaveLength(4);
    for (const requestSiteId of [siteId, otherSiteId]) {
      const subjects = rows
        .filter((row) => row.siteId === requestSiteId)
        .map((row) => (row.subject?.kind === "member" ? row.subject.memberId : null))
        .sort();
      expect(subjects).toEqual([f.target.memberId, otherTarget.memberId].sort());
    }
    expect(
      rows.every(
        (row) =>
          row.category === "abuse" &&
          row.severity === "info" &&
          row.confidenceBasis === "external" &&
          row.scoreBasisPoints === null &&
          row.evidence.length === 1,
      ),
    ).toBe(true);
    await noEffects(f);
  });

  it("rolls back advisory writes when current staff authority is revoked before commit", async () => {
    const f = await setup(1, { collect: false });
    const before = await retained(f);
    let observed = false;
    const collector = createAgentModeratorMemberReportCollectorV1({
      staffUserId: f.userId,
      now: f.now,
      incidents: {
        async observe(candidate, supplied) {
          if (!supplied?.transaction) throw new Error("Expected bounded collector transaction");
          const result = await f.writer.observe(candidate, supplied);
          expect(await supplied.transaction.select().from(npAgentSignals)).toHaveLength(1);
          expect(await supplied.transaction.select().from(npAgentIncidents)).toHaveLength(1);
          observed = true;
          await supplied.transaction
            .update(npUsers)
            .set({ role: "viewer" })
            .where(eq(npUsers.id, f.userId));
          return result;
        },
      },
    });
    await expect(
      collector.collect({ siteId, windowStartedAt: f.windowStartedAt }),
    ).rejects.toThrow();
    expect(observed).toBe(true);
    expect(await retained(f)).toEqual(before);
    expect((await f.db.select().from(npUsers).where(eq(npUsers.id, f.userId)))[0].role).toBe(
      "admin",
    );
  });

  it("allows real member resolution during capture and rejects its now-stale claim before advisory persistence", async () => {
    const f = await setup(1, { collect: false });
    await f.db.insert(npMemberRoles).values({
      memberId: f.target.memberId,
      role: "community-mod",
      scopeType: "site",
      scopeId: null,
      siteId,
      grantedBy: f.userId,
    });
    resetCommunityMemberReportObserverV1();
    const before = await retained(f);
    let resolved = false;
    const collector = createAgentModeratorMemberReportCollectorV1({
      staffUserId: f.userId,
      now: f.now,
      incidents: {
        async observe(candidate, supplied) {
          // The collector already holds this global target's row. A member
          // moderator may still resolve the report through its existing owner;
          // its resolvedByMemberId FK must not deadlock against that target lock.
          const result = await withCurrentSite(siteId, () =>
            resolveReport({
              reportId: f.reports[0]!.id,
              action: "dismiss",
              actor: { kind: "member", memberId: f.target.memberId },
            }),
          );
          expect(result.report.resolvedByMemberId).toBe(f.target.memberId);
          resolved = true;
          return f.writer.observe(candidate, supplied);
        },
      },
    });
    await expect(
      collector.collect({ siteId, windowStartedAt: f.windowStartedAt }),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_INVALID" });
    expect(resolved).toBe(true);
    expect(await retained(f)).toEqual(before);
    expect(
      (await f.db.select().from(npReports).where(eq(npReports.id, f.reports[0]!.id)))[0],
    ).toMatchObject({ resolvedAt: expect.any(Date), resolvedByMemberId: f.target.memberId });
    expect(
      (await f.db.select().from(npMembers).where(eq(npMembers.id, f.target.memberId)))[0].status,
    ).toBe("active");
    await noEffects(f);
  });

  it("rechecks target activity after host preparation before persisting an observation", async () => {
    const f = await fixture();
    let release: () => void = () => {
      throw new Error("Preparation gate is not initialized");
    };
    let prepared: () => void = () => {
      throw new Error("Preparation signal is not initialized");
    };
    const preparedPromise = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    setCommunityMemberReportObserverV1({
      async prepare(input) {
        await f.observer.prepare(input);
        prepared();
        await releasePromise;
      },
      record: f.observer.record,
    });
    const attempt = f.report();
    const rejected = expect(attempt).rejects.toThrow();
    await preparedPromise;
    await f.db
      .update(npMembers)
      .set({ status: "suspended" })
      .where(eq(npMembers.id, f.target.memberId));
    release();
    await rejected;
    expect(await f.db.select().from(npReports)).toEqual([]);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.action, "report.filed")),
    ).toEqual([]);
  });
});
