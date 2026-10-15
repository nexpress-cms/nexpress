import { and, eq, gte, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import {
  createMemberDocument,
  saveDocument,
  deleteMemberDocument,
  deleteDocument,
  updateMemberDocument,
  withDeferredPostCommit,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";
import {
  resetCommunityDocumentReportObserverV1,
  setCommunityDocumentReportObserverV1,
} from "../../../packages/core/src/community/document-report-observer.js";
import {
  npAgentEvents,
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidents,
  npAgentSignals,
  npAgentIncidentTimeline,
} from "../../../packages/core/src/db/schema/agent.js";
import { npReports, npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npUsers, npSessions, npRevisions } from "../../../packages/core/src/db/schema/system.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import {
  createAgentModeratorDocumentReportCollectorV1,
  createAgentModeratorDocumentReportObserverV1,
  npResolveAgentModeratorDocumentReportEvidenceV1,
} from "../../../packages/core/src/agent/moderator-document-report-source.js";
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
  collectionSlugs: ["discussions"],
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
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import {
  npRequireAgentEventCanonical,
  npDigestAgentEventCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import { npQuarantineCommunityContentV1 } from "../../../packages/core/src/community/content-containment.js";
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
  const members = await Promise.all(
    ["alice", "bravo", "charlie"].map((handle) =>
      seedActiveMember({ handle, email: `${handle}@example.com` }),
    ),
  );
  const never = () =>
    Promise.reject(new Error("Collection must not activate Runtime or call a provider"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, withCurrentRun: never, withRunAuthority: never, retry: never },
    deploymentAuthority: {
      policyId: "moderator-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: ["site:read"],
    },
    enqueueRun: never,
  });
  const observer = createAgentModeratorDocumentReportObserverV1({ events });
  const write = async (index: number) => {
    const body = npCreateEmptyRichTextContent();
    body.document.root.children[0]!.children = [
      {
        type: "text",
        version: 1,
        text: "Private document body me@example.com 192.0.2.1 https://offer.example/sale",
      },
    ];
    const saved = await withCurrentSite(siteId, () =>
      createMemberDocument(
        "discussions",
        { title: `Reported document ${randomUUID()}`, body },
        members[index % members.length]!.memberId,
      ),
    );
    return saved.doc;
  };
  const report = (targetId: string, reporterIndex = 0) =>
    withCurrentSite(siteId, () =>
      fileReport({
        targetType: "discussions",
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
    actor: { user, sessionId: session.id },
  };
}

const key = new Uint8Array(32).fill(83);
async function setup(
  count = 5,
  options: {
    duplicates?: boolean;
    collect?: boolean;
    sameAuthor?: boolean;
    staffDocument?: boolean;
  } = {},
) {
  const f = await fixture();
  setCommunityDocumentReportObserverV1(f.observer);
  // Actual owner writes may cross a ten-minute boundary. Retry a complete
  // fixture in the new bucket rather than altering immutable source timestamps.
  let documents: Record<string, unknown>[] = [];
  let reports: Awaited<ReturnType<typeof f.report>>[] = [];
  let windowStartedAt = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    documents = [];
    reports = [];
    for (let i = 0; i < count; i++) {
      const document = await f.write(options.sameAuthor ? 0 : i);
      documents.push(document);
      reports.push(await f.report(String(document.id)));
    }
    if (options.staffDocument) {
      const saved = await withCurrentSite(siteId, () =>
        saveDocument(
          "discussions",
          null,
          { title: `Staff document ${randomUUID()}`, body: documents[0]!.body },
          f.user,
          { status: "published" },
        ),
      );
      documents.push(saved.doc);
      reports.push(await f.report(String(saved.doc.id), 2));
    }
    if (options.duplicates) {
      reports.push(await f.report(String(documents[0]!.id), 1));
      reports.push(await f.report(String(documents[0]!.id), 2));
    }
    windowStartedAt = npAgentModeratorWindowStartedAtV1(reports[0]!.createdAt.toISOString());
    if (
      reports.every(
        (report) =>
          npAgentModeratorWindowStartedAtV1(report.createdAt.toISOString()) === windowStartedAt,
      )
    )
      break;
    if (attempt === 2)
      throw new Error("Document report fixture crossed every bounded window retry");
    // Invalidate every discarded target through its real owner. A partial batch
    // in the next bucket must not join the retry's evidence; immutable Events
    // and their actual occurredAt values remain untouched.
    for (const document of documents)
      await withCurrentSite(siteId, () =>
        typeof document.memberAuthorId === "string"
          ? deleteMemberDocument("discussions", String(document.id), document.memberAuthorId)
          : deleteDocument("discussions", String(document.id), f.user),
      );
  }
  const now = () => new Date(Date.parse(windowStartedAt) + 600001);
  const writer = createAgentIncidentWriteServiceV1({
    now,
    resolveEvidence: ({ db, candidate }) =>
      npResolveAgentModeratorDocumentReportEvidenceV1({ db, candidate, staffUserId: f.userId }),
  });
  const collector = createAgentModeratorDocumentReportCollectorV1({
    staffUserId: f.userId,
    incidents: writer,
    now,
  });
  const collected =
    options.collect === false
      ? { inspectedEvents: 0, acceptedFacts: 0, observations: [] }
      : await collector.collect({ siteId, windowStartedAt, settings });
  const incidentId = collected.observations[0]?.incidentId ?? randomUUID();
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
    collected,
    documents,
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
  rules.resources.collections = ["discussions"];
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
  const response = createAgentIncidentResponseServiceV1({
    reads: f.reads,
    moderation,
    approvals,
    resolveTargets: f.evidence.resolveTargets,
    admission: {
      reauthentication: {
        verify: () => ({
          reauthenticatedAt: new Date().toISOString(),
          sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
        }),
      },
    },
  });
  return { response, approvals };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
async function approve(f: Fixture, approvals: NpAgentApprovalServiceV1, approvalId: string) {
  const reviewer = await seedUser({ role: "admin" });
  const [session] = await f.db
    .select()
    .from(npSessions)
    .where(eq(npSessions.userId, reviewer.userId));
  const [raw] = await f.db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, reviewer.userId));
  const identity = {
    siteId,
    actor: { user: npRequireAuthUser(raw), sessionId: session.id },
    id: approvalId,
  };
  const detail = await approvals.get(identity);
  const challenge = await approvals.issueChallenge({
    ...identity,
    command: {
      schemaVersion: "np.agent-approval-challenge-request.v1",
      purpose: "approve",
      expectedApprovalVersion: detail.item.version,
      statementHash: detail.item.statementHash,
      idempotencyKey: randomUUID(),
    },
  });
  await approvals.decide({
    ...identity,
    decision: "approve",
    command: {
      schemaVersion: "np.agent-approval-decision-input.v1",
      expectedApprovalVersion: challenge.approvalVersion,
      statementHash: detail.item.statementHash,
      challengeGeneration: challenge.challengeGeneration,
      challenge: challenge.challenge,
      idempotencyKey: randomUUID(),
      reason: "Reviewed exact document and current version",
    },
  });
}
async function retained(f: Fixture) {
  return {
    signals: await f.db.select().from(npAgentSignals),
    incidents: await f.db.select().from(npAgentIncidents),
    timeline: await f.db.select().from(npAgentIncidentTimeline),
  };
}
function registerDocuments() {
  registerTestCollections();
  const config = getCollectionConfig("discussions");
  registerCollection("discussions", discussionsTable, {
    ...config,
    community: { ...config.community, reports: true, moderation: { hiddenField: "locked" } },
  });
}

describe.skipIf(skipIfNoTestDb())("Incident actual document report evidence", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerDocuments();
  });
  afterEach(() => {
    resetCommunityDocumentReportObserverV1();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("preserves filing without installation and atomically rolls back the real report, audit and Event on recording failure", async () => {
    const f = await fixture();
    const document = await f.write(0);
    const legacy = await f.report(String(document.id));
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    setCommunityDocumentReportObserverV1({
      prepare: f.observer.prepare,
      async record(input) {
        await f.observer.record(input);
        throw new Error("durable document report recording failed");
      },
    });
    await expect(f.report(String(document.id), 1)).rejects.toThrow(
      "durable document report recording failed",
    );
    expect(await f.db.select().from(npReports)).toEqual([legacy]);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.action, "report.filed")),
    ).toHaveLength(1);
    setCommunityDocumentReportObserverV1(f.observer);
    const report = await f.report(String(document.id), 1);
    await f.observer.record({
      db: f.db,
      report,
      document,
      config: getCollectionConfig("discussions"),
    });
    const events = await f.db.select().from(npAgentEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "community.content.reported",
      sourceComponent: "community.document-reports",
      subject: { kind: "document", collection: "discussions", documentId: document.id },
      occurredAt: report.createdAt,
    });
    expect(JSON.stringify(events)).not.toContain(legacy.id);
    await f.db.transaction(async (transaction) => {
      await transaction.select().from(npReports).where(eq(npReports.id, report.id)).for("update");
      await expect(f.report(String(document.id), 1)).rejects.toMatchObject({ code: "CONFLICT" });
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
  });

  it("retains one advisory campaign for distinct document authors without multiplying targets or reporter independence", async () => {
    const f = await setup(5, { duplicates: true });
    expect(f.collected.acceptedFacts).toBe(7);
    expect(f.collected.observations).toHaveLength(1);
    const before = await retained(f);
    expect(before.signals).toHaveLength(1);
    expect(before.signals[0]).toMatchObject({ subject: null, scoreBasisPoints: 7000 });
    expect(before.signals[0].evidence).toHaveLength(5);
    for (const stricter of [
      { ...settings, minItems: 6 },
      { ...settings, minIndependentAccounts: 4 },
    ])
      expect(
        (
          await f.collector.collect({
            siteId,
            windowStartedAt: f.windowStartedAt,
            settings: stricter,
          })
        ).observations,
      ).toEqual([]);
    expect(
      (await f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt, settings }))
        .observations[0],
    ).toMatchObject({ incidentId: f.input.incidentId, disposition: "replayed" });
    expect(await retained(f)).toEqual(before);
    expect(
      await f.db.select().from(discussionsTable).where(eq(discussionsTable.locked, true)),
    ).toEqual([]);
  });

  it("does not treat three reporters or an unknown staff author as independent target authors", async () => {
    const f = await setup(5, {
      duplicates: true,
      sameAuthor: true,
      staffDocument: true,
      collect: false,
    });
    const batch = await f.collector.collect({
      siteId,
      windowStartedAt: f.windowStartedAt,
      settings,
    });
    expect(batch.acceptedFacts).toBe(8);
    expect(batch.observations).toEqual([]);
    const sourceEvents = await f.db.select().from(npAgentEvents);
    expect(
      sourceEvents.filter(
        (event) =>
          event.payload.kind === "community.content.reported" &&
          event.payload.authorMemberId === null &&
          event.subject?.kind === "document" &&
          event.subject.documentId === f.documents[f.documents.length - 1]!.id,
      ),
    ).toHaveLength(1);
    expect(new Set(f.reports.map((report) => report.reporterId)).size).toBe(3);
    expect(await retained(f)).toEqual({ signals: [], incidents: [], timeline: [] });
  });

  it("projects exact current document metadata and uses signed human approvals for quarantine and exact restoration", async () => {
    const f = await setup();
    const page = await f.studio.evidence(f.input);
    expect(page.items).toHaveLength(5);
    expect(
      page.items.every(
        (item) =>
          item.target?.kind === "document" &&
          item.target.collection === "discussions" &&
          item.observed?.status === "published" &&
          item.observed.visibility === "public" &&
          item.observed.reportFiled === true &&
          item.observed.spamVerdict === "unknown" &&
          item.observed.profanityVerdict === "unknown" &&
          item.current?.state === "unchanged" &&
          item.current.status === "published" &&
          item.current.visibility === "public" &&
          item.current.moderationHidden === false &&
          item.current.report?.status === "unresolved" &&
          item.responseEligible,
      ),
    ).toBe(true);
    const wire = JSON.stringify(page);
    for (const secret of [
      "Private document body",
      "Private report reason",
      "me@example.com",
      "192.0.2.1",
      f.members[0]!.memberId,
      f.reports[0]!.id,
      "reporterId",
      "memberAuthorId",
      "deduplicationKey",
      "eventHash",
    ])
      expect(wire).not.toContain(secret);
    const { response, approvals } = await responses(f);
    const initial = await response.get(f.input);
    expect(initial.choices).toHaveLength(5);
    const choice = initial.choices[0]!;
    const [original] = await f.db
      .select()
      .from(discussionsTable)
      .where(eq(discussionsTable.id, choice.target.id));
    expect(page.items.find((item) => item.target?.id === choice.target.id)?.current).toMatchObject({
      versionDigest: choice.expectedVersionDigest,
      editedAt: original.updatedAt.toISOString(),
    });
    const after = vi.fn(({ data }: { data: Record<string, unknown> }) => data);
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", discussionsTable, {
      ...config,
      hooks: { afterUpdate: [after] },
    });
    const beforeRevisions = await f.db
      .select()
      .from(npRevisions)
      .where(eq(npRevisions.documentId, choice.target.id));
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
    });
    const plan = (await response.get(f.input)).plans[0]!;
    expect(plan.canExecute).toBe(false);
    const command = {
      schemaVersion: "np.agent-incident-response-execute-input.v1" as const,
      expectedVersion: 1,
      actionId: plan.actionId,
      approvalId: plan.approvalId,
      proposalHash: plan.proposalHash,
      idempotencyKey: randomUUID(),
    };
    await expect(response.responseExecute({ ...f.input, command })).rejects.toThrow();
    expect(
      (
        await f.db.select().from(discussionsTable).where(eq(discussionsTable.id, choice.target.id))
      )[0],
    ).toEqual(original);
    expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    await approve(f, approvals, plan.approvalId);
    expect((await response.get(f.input)).plans[0]!.canExecute).toBe(true);
    expect(await response.responseExecute({ ...f.input, command })).toMatchObject({
      replayed: false,
    });
    expect(await response.responseExecute({ ...f.input, command })).toMatchObject({
      replayed: true,
    });
    expect(after).toHaveBeenCalledOnce();
    const [quarantined] = await f.db
      .select()
      .from(discussionsTable)
      .where(eq(discussionsTable.id, choice.target.id));
    expect(quarantined).toMatchObject({
      status: "pending",
      locked: true,
      visibility: original.visibility,
      body: original.body,
      title: original.title,
      memberAuthorId: original.memberAuthorId,
    });
    expect(
      (await f.evidence.get(f.input)).items.find((item) => item.target?.id === choice.target.id),
    ).toMatchObject({
      current: { state: "hidden", status: "pending", moderationHidden: true },
      responseEligible: false,
    });
    const restoreChoice = (await response.get(f.input)).choices.find(
      (item) => item.capabilityId === "moderation.restore",
    )!;
    const { incident } = await f.reads.get({ incidentId: f.input.incidentId }, f.input);
    await response.responsePlan({
      ...f.input,
      command: {
        schemaVersion: "np.agent-incident-response-plan-input.v1",
        expectedVersion: incident.versionNumber,
        capabilityId: "moderation.restore",
        proposal: {
          containmentKind: "content_quarantine",
          containmentId: restoreChoice.containmentId!,
          expectedVersionDigest: restoreChoice.expectedVersionDigest,
        },
        idempotencyKey: randomUUID(),
      },
    });
    const restorePlan = (await response.get(f.input)).plans.find(
      (item) => item.capabilityId === "moderation.restore",
    )!;
    await approve(f, approvals, restorePlan.approvalId);
    const restore = {
      schemaVersion: "np.agent-incident-response-execute-input.v1" as const,
      expectedVersion: incident.versionNumber,
      actionId: restorePlan.actionId,
      approvalId: restorePlan.approvalId,
      proposalHash: restorePlan.proposalHash,
      idempotencyKey: randomUUID(),
    };
    expect(await response.restore({ ...f.input, command: restore })).toMatchObject({
      replayed: false,
    });
    expect(await response.restore({ ...f.input, command: restore })).toMatchObject({
      replayed: true,
    });
    const [restored] = await f.db
      .select()
      .from(discussionsTable)
      .where(eq(discussionsTable.id, choice.target.id));
    expect(restored).toMatchObject({
      status: original.status,
      visibility: original.visibility,
      locked: original.locked,
      title: original.title,
      body: original.body,
      memberAuthorId: original.memberAuthorId,
    });
    expect(after).toHaveBeenCalledTimes(2);
    expect(
      await f.db.select().from(npRevisions).where(eq(npRevisions.documentId, choice.target.id)),
    ).toHaveLength(beforeRevisions.length + 2);
    expect(await f.db.select().from(npAgentActions)).toHaveLength(2);
    expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
    expect(
      (await f.db.select().from(npAgentApprovals)).every((row) => row.state === "consumed"),
    ).toBe(true);
  });

  it("refuses an already approved exact document action after an owner edit without consuming human authority", async () => {
    const f = await setup();
    const { response, approvals } = await responses(f);
    const choice = (await response.get(f.input)).choices[0]!;
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
    });
    const plan = (await response.get(f.input)).plans[0]!;
    await approve(f, approvals, plan.approvalId);
    const document = f.documents.find((item) => item.id === choice.target.id)!;
    await withCurrentSite(siteId, () =>
      updateMemberDocument(
        "discussions",
        choice.target.id,
        { title: "Owner edited after human approval" },
        String(document.memberAuthorId),
      ),
    );
    const before = await retained(f);
    await expect(
      response.responseExecute({
        ...f.input,
        command: {
          schemaVersion: "np.agent-incident-response-execute-input.v1",
          expectedVersion: 1,
          actionId: plan.actionId,
          approvalId: plan.approvalId,
          proposalHash: plan.proposalHash,
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    expect(await retained(f)).toEqual(before);
    expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    expect(
      (
        await f.db.select().from(npAgentApprovals).where(eq(npAgentApprovals.id, plan.approvalId))
      )[0].state,
    ).toBe("approved");
    expect(
      (
        await f.db.select().from(discussionsTable).where(eq(discussionsTable.id, choice.target.id))
      )[0],
    ).toMatchObject({
      title: "Owner edited after human approval",
      status: "published",
      locked: false,
    });
    expect(
      (await response.get(f.input)).choices.every((item) => item.target.id !== choice.target.id),
    ).toBe(true);
  });

  it("invalidates continuation and fresh choices on report resolution, actual document edits, and hidden state", async () => {
    const f = await setup(11);
    const { response } = await responses(f);
    const legacy = await response.get(f.input);
    expect(legacy.choices).toHaveLength(11);
    expect(legacy).not.toHaveProperty("nextCursor");
    const responsePage = await response.get({ ...f.input, cursor: null });
    expect(responsePage.choices).toHaveLength(10);
    expect(responsePage.nextCursor).toEqual(expect.any(String));
    expect(
      (await response.get({ ...f.input, cursor: responsePage.nextCursor })).choices,
    ).toHaveLength(1);
    const first = await f.evidence.get(f.input);
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    expect((await f.evidence.get({ ...f.input, cursor: first.nextCursor })).items).toHaveLength(1);
    const report = f.reports.find((item) => item.targetId === first.items[0]!.target!.id)!;
    await withCurrentSite(siteId, () =>
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
    expect(afterResolution.items.find((item) => item.target?.id === report.targetId)).toMatchObject(
      { current: { state: "unchanged", report: { status: "resolved" } }, responseEligible: false },
    );
    const editable = f.documents.filter((document) => document.id !== report.targetId);
    await withCurrentSite(siteId, () =>
      updateMemberDocument(
        "discussions",
        String(editable[0]!.id),
        { title: "Actual owner edit" },
        String(editable[0]!.memberAuthorId),
      ),
    );
    const hiddenChoice = (await response.get(f.input)).choices.find(
      (choice) => choice.target.id === editable[1]!.id,
    )!;
    await withCurrentSite(siteId, () =>
      withDeferredPostCommit(() =>
        f.db.transaction((tx) =>
          npQuarantineCommunityContentV1(tx as unknown as NpTransaction, {
            siteId,
            target: hiddenChoice.target,
            user: f.user,
            expectedVersionDigest: hiddenChoice.expectedVersionDigest,
            reasonCode: "HUMAN_REVIEW",
          }),
        ),
      ),
    );
    await expect(
      f.evidence.get({ ...f.input, cursor: afterResolution.nextCursor }),
    ).rejects.toMatchObject({ code: "INCIDENT_EVIDENCE_CURSOR_INVALID" });
    const page = await f.evidence.get(f.input);
    const remainder = await f.evidence.get({ ...f.input, cursor: page.nextCursor });
    const all = [...page.items, ...remainder.items];
    expect(all.find((item) => item.target?.id === editable[0]!.id)).toMatchObject({
      current: { state: "changed" },
      responseEligible: false,
    });
    expect(all.find((item) => item.target?.id === editable[1]!.id)).toMatchObject({
      current: { state: "hidden", moderationHidden: true },
      responseEligible: false,
    });
    const forbidden = [report.targetId, String(editable[0]!.id), String(editable[1]!.id)];
    const available = (await response.get(f.input)).choices.filter(
      (choice) => choice.capabilityId === "moderation.quarantine",
    );
    expect(available).toHaveLength(8);
    expect(available.every((choice) => !forbidden.includes(choice.target.id))).toBe(true);
    await expect(
      response.responsePlan({
        ...f.input,
        command: {
          schemaVersion: "np.agent-incident-response-plan-input.v1",
          expectedVersion: (await f.reads.get({ incidentId: f.input.incidentId }, f.input)).incident
            .versionNumber,
          capabilityId: "moderation.quarantine",
          proposal: {
            incidentId: f.input.incidentId,
            target: hiddenChoice.target,
            expectedVersionDigest: hiddenChoice.expectedVersionDigest,
            reasonCode: "REPEATED_LINK_SPAM",
          },
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_RESPONSE_UNAVAILABLE" });
    expect(await f.db.select().from(npAgentActions)).toEqual([]);
    expect(
      (await f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt, settings }))
        .acceptedFacts,
    ).toBe(8);
  });

  it("denies inaccessible, cross-site and tampered historical evidence without changing retained Incident state", async () => {
    const f = await setup();
    const before = await retained(f);
    const [event] = await f.db.select().from(npAgentEvents);
    const deny = async () => {
      await expect(f.evidence.get(f.input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
      expect(await retained(f)).toEqual(before);
    };
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentEvents.id, event.id));
    await deny();
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: event.eventHash })
      .where(eq(npAgentEvents.id, event.id));
    const report = f.reports[0]!;
    for (const change of [
      { siteId: "other-site" },
      { reason: "Tampered historical private report" },
      { targetId: randomUUID() },
    ]) {
      await f.db.update(npReports).set(change).where(eq(npReports.id, report.id));
      await deny();
      await f.db
        .update(npReports)
        .set({ siteId, reason: report.reason, targetId: report.targetId })
        .where(eq(npReports.id, report.id));
    }
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", discussionsTable, {
      ...config,
      access: { read: () => false },
    });
    try {
      await deny();
    } finally {
      registerDocuments();
    }
    await f.db.update(npUsers).set({ role: "viewer" }).where(eq(npUsers.id, f.userId));
    await expect(f.evidence.get(f.input)).rejects.toThrow();
    await f.db.update(npUsers).set({ role: "admin" }).where(eq(npUsers.id, f.userId));
    await expect(f.evidence.get({ ...f.input, siteId: "other-site" })).rejects.toThrow();
    expect((await f.evidence.get(f.input)).items).toHaveLength(5);
    const document = f.documents[0]!;
    await withCurrentSite(siteId, () =>
      deleteMemberDocument("discussions", String(document.id), String(document.memberAuthorId)),
    );
    await deny();
  });

  it("enforces the exact raw Event bound before inspection without modifying retained evidence", async () => {
    const f = await setup();
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
    // Canonical capacity-only rows exercise the pre-inspection SQL limit. They
    // are not claimed to be actual report filings or evidence acceptance.
    const extra = await Promise.all(
      Array.from({ length: 101 - originalEvents.length }, async (_, index) => {
        const deduplicationKey = `document.capacity.${index}`;
        const canonical = npRequireAgentEventCanonical({
          version: "np.agent-event.v1",
          siteId,
          kind: source.kind,
          occurredAt: source.occurredAt.toISOString(),
          source: { kind: source.sourceKind, component: source.sourceComponent },
          subject: source.subject,
          actor: source.actor,
          causation: source.causation,
          correlationId: source.correlationId,
          deduplicationKey,
          privacy: source.privacy,
          payload: source.payload,
        });
        return {
          ...source,
          id: randomUUID(),
          deduplicationKey,
          eventHash: await npDigestAgentEventCanonical(canonical),
        };
      }),
    );
    await f.db.insert(npAgentEvents).values(extra.slice(0, -1));
    expect(
      (await f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt, settings }))
        .inspectedEvents,
    ).toBe(100);
    const before = await retained(f);
    await f.db.insert(npAgentEvents).values(extra[extra.length - 1]!);
    await expect(
      f.collector.collect({ siteId, windowStartedAt: f.windowStartedAt, settings }),
    ).rejects.toMatchObject({ code: "MODERATOR_COLLECTION_LIMIT" });
    expect(await retained(f)).toEqual(before);
  });

  it("rolls back real Signal, Incident and timeline writes if current staff authority changes before commit", async () => {
    const f = await setup(5, { collect: false });
    const before = await retained(f);
    expect(before).toEqual({ signals: [], incidents: [], timeline: [] });
    let observed = false;
    const collector = createAgentModeratorDocumentReportCollectorV1({
      staffUserId: f.userId,
      now: () => new Date(Date.parse(f.windowStartedAt) + 600001),
      incidents: {
        ...f.writer,
        async observe(candidate, supplied) {
          if (!supplied?.transaction) throw new Error("Expected collector transaction");
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
      collector.collect({ siteId, windowStartedAt: f.windowStartedAt, settings }),
    ).rejects.toThrow();
    expect(observed).toBe(true);
    expect(await retained(f)).toEqual(before);
    expect((await f.db.select().from(npUsers).where(eq(npUsers.id, f.userId)))[0].role).toBe(
      "admin",
    );
  });
});
