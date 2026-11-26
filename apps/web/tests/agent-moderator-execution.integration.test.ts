import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { createAgentIncidentNotificationsServiceV1 } from "../../../packages/core/src/agent/incident-notifications-service.js";
import { createAgentIncidentResponseServiceV1 } from "../../../packages/core/src/agent/incident-response-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentNotifications,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npAuditEvents,
  npComments,
  npMembers,
} from "../../../packages/core/src/db/schema/community.js";
import { npSessions, npSiteMemberships } from "../../../packages/core/src/db/schema/system.js";
import { grantSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import type { NpAgentAdminActorV1 } from "../../../packages/core/src/agent/admin-admission.js";
import { discussionsTable } from "../../../packages/core/src/integration/fixtures.js";
import {
  createAgentApprovalServiceV1,
  type NpAgentApprovalServiceV1,
} from "../../../packages/core/src/agent/approval-service.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { createAgentModerationServiceV1 } from "../../../packages/core/src/agent/moderation-service.js";
import {
  createAgentModerationCapabilityFacadeV1,
  type NpAgentModerationCapabilityFacadeV1,
} from "../../../packages/core/src/agent/moderation-capability.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import { npInspectCommunityContentContainmentV1 } from "../../../packages/core/src/community/content-containment.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import type { NpAgentApprovalDetailV1 } from "../../../packages/core/src/agent-contract/approval-contract.js";
import type { NpAgentDirectActionApprovalRequiredV1 } from "../../../packages/core/src/agent-contract/moderator-contract.js";
import type {
  NpAgentModerationCapabilityIdV1,
  NpAgentModerationCapabilityInvocationRequestV1,
  NpAgentModerationCapabilityInvocationResultV1,
} from "../../../packages/core/src/agent-contract/moderation-capability-contract.js";
import { fixture, principalFixture, siteId } from "./agent-changeset-fixture.js";
import { runtimeBudget } from "./agent-runtime-service-fixture.js";
import { npResolveAgentBudgetV1 } from "../../../packages/core/src/agent-contract/runtime-budget.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  seedUser,
  truncateAll,
} from "./harness.js";

async function moderationFixture(
  options: {
    notifications?: boolean;
    failNotification?: boolean;
    recoverFailures?: boolean;
    denyFailureRead?: boolean;
    documentTarget?: boolean;
  } = {},
) {
  let time = new Date();
  let failTimeline = false;
  let denyFailureRead = options.denyFailureRead ?? false;
  const f = await fixture();
  if (options.documentTarget) {
    const config = getCollectionConfig("discussions");
    registerCollection("discussions", getCollectionTable("discussions"), {
      ...config,
      community: { ...config.community, reports: true, moderation: { hiddenField: "locked" } },
    });
  }
  const principal = await principalFixture(
    f,
    false,
    { now: () => time },
    ["moderation:execute"],
    "approved-execute",
  );
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  const budget = npResolveAgentBudgetV1(runtimeBudget());
  rules.capabilityModes = [
    { capabilityId: "moderation.quarantine", mode: "approved" },
    { capabilityId: "moderation.restore", mode: "approved" },
  ];
  rules.resources.collections = ["discussions"];
  rules.resources.incidentCategories = ["spam"];
  rules.risk.requirePreviewAtOrAbove = null;
  rules.automation.moderationTargetsPerRun = 1;
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "moderation-read", key: new Uint8Array(32).fill(45) },
      resolveBlockSchemas: () => [],
      resolveUser: () => f.actor.actor.user,
    }),
  );
  let facade: NpAgentModerationCapabilityFacadeV1 | null = null;
  let approvals: NpAgentApprovalServiceV1 | null = null;
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    resolveModerationCapabilities: () => facade,
    resolveGatewaySettings: () => principal.gatewaySettings,
    now: () => time,
  });
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(71),
    canReadIncident: () => true,
    canReadStaffIncident: () => true,
  });
  const notifications = createAgentIncidentNotificationsServiceV1({
    reads: reads.staff,
    cursorHmacKey: new Uint8Array(32).fill(72),
    canReviewAction: () => !denyFailureRead,
    recoverFailures: options.recoverFailures,
    now: () => time,
  });
  const incidents = createAgentIncidentWriteServiceV1({
    resolveEvidence: () => false,
    notifications: options.notifications
      ? options.recoverFailures
        ? notifications
        : {
            record: async (input) => {
              await notifications.record(input);
              if (options.failNotification) throw new Error("Notification persistence unavailable");
            },
          }
      : undefined,
    now: () => time,
  });
  const service = createAgentModerationServiceV1({
    admission,
    resolveApprovals: () => {
      if (!approvals) throw new Error("Approval owner not installed");
      return approvals;
    },
    resolveTransportAudience: principal.gateway.getTransportAudience,
    resolveBudget: () => Promise.resolve(budget),
    resolvePolicy: () =>
      Promise.resolve({
        autonomy: "approved",
        capabilityModes: rules.capabilityModes,
        layers: [rules],
      }),
    resolveStaffPolicy: () =>
      Promise.resolve({
        autonomy: "approved",
        capabilityModes: rules.capabilityModes,
        layers: [rules],
      }),
    canReadIncident: () => Promise.resolve(true),
    incidents: {
      appendFailedContainmentEvent: incidents.appendFailedContainmentEvent,
      appendContainmentEvent: (input) =>
        failTimeline
          ? Promise.reject(new Error("Incident timeline persistence failed"))
          : incidents.appendContainmentEvent(input),
    },
    now: () => time,
  });
  facade = createAgentModerationCapabilityFacadeV1(service);
  approvals = createAgentApprovalServiceV1({
    targets: service.approvalTargets,
    cursorKey: new Uint8Array(32).fill(46),
    integrityKeys: {
      active: {
        owner: "approval-integrity",
        id: "moderation-integrity",
        bytes: new Uint8Array(32).fill(47),
      },
    },
    challengeKeys: { active: { id: "moderation-challenge", key: new Uint8Array(32).fill(48) } },
    secretRequestDigestKey: { id: "moderation-request", key: new Uint8Array(32).fill(49) },
    reauthentication: {
      verify: () => ({
        reauthenticatedAt: time.toISOString(),
        sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
      }),
    },
    now: () => time,
  });
  const [member] = await f.db
    .insert(npMembers)
    .values({
      email: `${randomUUID()}@example.com`,
      handle: `mod-${randomUUID()}`,
      displayName: "Moderation fixture",
      status: "active",
    })
    .returning();
  const [document] = await f.db
    .insert(discussionsTable)
    .values({
      siteId,
      title: "Observed discussion",
      slug: `moderation-${randomUUID()}`,
      body: npCreateEmptyRichTextContent(),
      status: "published",
      memberAuthorId: member.id,
    })
    .returning();
  const [comment] = await f.db
    .insert(npComments)
    .values({
      siteId,
      targetType: "discussions",
      targetId: document.id,
      memberId: member.id,
      bodyMd: "Pending comment kept intact",
      bodyHtml: "<p>Pending comment kept intact</p>",
      status: "pending",
    })
    .returning();
  const [incident] = await f.db
    .insert(npAgentIncidents)
    .values({
      siteId,
      category: "spam",
      status: "open",
      severity: options.notifications ? "high" : "medium",
      fingerprint: `moderation-${randomUUID()}`,
      title: "Repeated links under review",
      summary: "Bounded evidence review.",
      primarySubject: {
        kind: "comment",
        commentId: comment.id,
        collection: "discussions",
        documentId: document.id,
      },
      firstObservedAt: time,
      lastObservedAt: time,
      createdAt: time,
      updatedAt: time,
    })
    .returning();
  const target = options.documentTarget
    ? { kind: "document" as const, collection: "discussions", id: document.id }
    : { kind: "comment" as const, collection: "discussions", id: comment.id };
  const inspected = await withCurrentSite(siteId, () =>
    f.db.transaction((tx) =>
      npInspectCommunityContentContainmentV1(tx, { siteId, target, user: f.actor.actor.user }),
    ),
  );
  const quarantineRequest: NpAgentModerationCapabilityInvocationRequestV1 = {
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId: "moderation.quarantine",
    arguments: {
      idempotencyKey: randomUUID(),
      input: {
        mode: "propose",
        proposal: {
          incidentId: incident.id,
          target,
          expectedVersionDigest: inspected.versionDigest,
          reasonCode: "REPEATED_LINK_SPAM",
        },
      },
    },
  };
  function invoke(request: NpAgentModerationCapabilityInvocationRequestV1) {
    return admission.invoke({ authentication: principal.authentication, request });
  }
  return {
    ...f,
    notifications,
    incidents,
    principal,
    admission,
    approvals,
    service,
    rules,
    budget,
    document,
    comment,
    incident,
    quarantineRequest,
    invoke,
    now: () => time,
    advance: (seconds: number) => {
      time = new Date(time.getTime() + seconds * 1000);
    },
    failTimeline: (value: boolean) => {
      failTimeline = value;
    },
    denyFailureRead: (value: boolean) => {
      denyFailureRead = value;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof moderationFixture>>;
const recoverySchema = "np.agent-incident-notification-recovery-entry.v1";
async function failLocalNotificationInserts(f: Fixture, fail: boolean) {
  // Exercise PostgreSQL's aborted savepoint rather than an injected service error.
  await f.db.execute(
    fail
      ? sql`ALTER TABLE np_agent_notifications ADD CONSTRAINT np_test_notification_unavailable CHECK (channel <> 'admin') NOT VALID`
      : sql`ALTER TABLE np_agent_notifications DROP CONSTRAINT IF EXISTS np_test_notification_unavailable`,
  );
}
async function rolledBackFailure(f: Fixture) {
  const approval = required(await f.invoke(f.quarantineRequest));
  await decide(f, approval.approvalId);
  const execute = execution("moderation.quarantine", approval);
  const config = getCollectionConfig("discussions");
  const hooks = config.hooks;
  let deferredCalls = 0;
  config.hooks = {
    beforeUpdate: [({ data }) => ({ ...data, title: "Unexpected recovery fixture mutation" })],
    afterUpdate: [
      ({ data }) => {
        deferredCalls++;
        return data;
      },
    ],
  };
  try {
    const result = await f.invoke(execute);
    expect(result.output).toMatchObject({ state: "failed", containmentId: null });
    expect(deferredCalls).toBe(0);
    expect(
      (await f.db.select().from(discussionsTable).where(eq(discussionsTable.id, f.document.id)))[0],
    ).toMatchObject({ title: f.document.title, status: "published", locked: false });
    expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    const [source] = await f.db
      .select()
      .from(npAgentIncidentTimeline)
      .where(
        and(
          eq(npAgentIncidentTimeline.kind, "action"),
          eq(npAgentIncidentTimeline.incidentId, f.incident.id),
        ),
      );
    expect(source).toMatchObject({
      actionId: approval.actionId,
      details: { outcome: "rolled_back", transitionVersion: 2 },
    });
    return { approval, execute, result, source };
  } finally {
    config.hooks = hooks;
  }
}
async function recoveryJournal(f: Fixture) {
  return f.db
    .select()
    .from(npAgentIncidentTimeline)
    .where(
      and(
        eq(npAgentIncidentTimeline.kind, "notification"),
        eq(npAgentIncidentTimeline.incidentId, f.incident.id),
      ),
    )
    .orderBy(asc(npAgentIncidentTimeline.sequence));
}
function recoveryOwners(f: Fixture) {
  const { recover, recordFailure, recoveryState } = f.notifications;
  if (!recover || !recordFailure || !recoveryState) throw new Error("Recovery owner required");
  return { recover, recordFailure, recoveryState };
}
async function executionFacts(f: Fixture) {
  return {
    document: await f.db.select().from(discussionsTable),
    comments: await f.db.select().from(npComments),
    actions: await f.db.select().from(npAgentActions).orderBy(npAgentActions.id),
    approvals: await f.db.select().from(npAgentApprovals).orderBy(npAgentApprovals.id),
    invocations: await f.db.select().from(npAgentInvocations).orderBy(npAgentInvocations.id),
    runs: await f.db.select().from(npAgentRuns).orderBy(npAgentRuns.id),
    containments: await f.db.select().from(npAgentContainments),
    audit: await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id),
  };
}
function required(
  result: NpAgentModerationCapabilityInvocationResultV1,
): NpAgentDirectActionApprovalRequiredV1 {
  if (result.output.state !== "approval_required") throw new Error("Expected human approval");
  return result.output;
}
async function decide(
  f: Fixture,
  approvalId: string,
  decision: "approve" | "revoke" = "approve",
  actor: NpAgentAdminActorV1 = f.actor.actor,
) {
  const identity = { siteId, actor, id: approvalId };
  const detail = await f.approvals.get(identity);
  const challenge = await f.approvals.issueChallenge({
    ...identity,
    command: {
      schemaVersion: "np.agent-approval-challenge-request.v1",
      purpose: decision,
      expectedApprovalVersion: detail.item.version,
      statementHash: detail.item.statementHash,
      idempotencyKey: randomUUID(),
    },
  });
  return f.approvals.decide({
    ...identity,
    decision,
    command: {
      schemaVersion: "np.agent-approval-decision-input.v1",
      expectedApprovalVersion: challenge.approvalVersion,
      statementHash: detail.item.statementHash,
      challengeGeneration: challenge.challengeGeneration,
      challenge: challenge.challenge,
      idempotencyKey: randomUUID(),
      reason: "Reviewed exact target and version",
    },
  });
}
function execution(
  capabilityId: NpAgentModerationCapabilityIdV1,
  approval: NpAgentDirectActionApprovalRequiredV1,
): NpAgentModerationCapabilityInvocationRequestV1 {
  return {
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId,
    arguments: {
      idempotencyKey: randomUUID(),
      input: {
        mode: "execute_approved",
        actionId: approval.actionId,
        approvalId: approval.approvalId,
        proposalHash: approval.proposalHash,
      },
    },
  };
}
async function assertUntouched(f: Fixture, detail?: NpAgentApprovalDetailV1) {
  expect(
    (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0],
  ).toMatchObject({ status: "pending" });
  expect(await f.db.select().from(npAgentContainments)).toEqual([]);
  if (detail)
    expect(
      (
        await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, detail.item.approval.id))
      )[0].state,
    ).toBe("approved");
}

async function assertRetained(f: Fixture, sourceActionId: string, approvalId: string) {
  const before = {
    actions: await f.db.select().from(npAgentActions).orderBy(npAgentActions.id),
    approvals: await f.db.select().from(npAgentApprovals).orderBy(npAgentApprovals.id),
    invocations: await f.db.select().from(npAgentInvocations).orderBy(npAgentInvocations.id),
    runs: await f.db.select().from(npAgentRuns).orderBy(npAgentRuns.id),
    containments: await f.db.select().from(npAgentContainments).orderBy(npAgentContainments.id),
  };
  await pruneAgentRuntimeEventsV1({ siteId, now: new Date(Date.now() + 401 * 86_400_000) });
  await expect(
    f.db.delete(npAgentActions).where(eq(npAgentActions.id, sourceActionId)),
  ).rejects.toThrow();
  await expect(
    f.db.delete(npAgentApprovals).where(eq(npAgentApprovals.id, approvalId)),
  ).rejects.toThrow();
  expect({
    actions: await f.db.select().from(npAgentActions).orderBy(npAgentActions.id),
    approvals: await f.db.select().from(npAgentApprovals).orderBy(npAgentApprovals.id),
    invocations: await f.db.select().from(npAgentInvocations).orderBy(npAgentInvocations.id),
    runs: await f.db.select().from(npAgentRuns).orderBy(npAgentRuns.id),
    containments: await f.db.select().from(npAgentContainments).orderBy(npAgentContainments.id),
  }).toEqual(before);
}

describe.skipIf(skipIfNoTestDb())("Moderator reviewed Gateway execution", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("recovers only due local notification failures with frozen evidence and concurrent replay", async () => {
    const f = await moderationFixture({
      notifications: true,
      recoverFailures: true,
      documentTarget: true,
    });
    const owners = recoveryOwners(f);
    await failLocalNotificationInserts(f, true);
    try {
      const { source, execute, result } = await rolledBackFailure(f);
      const identity = {
        siteId,
        actor: f.actor.actor,
        incidentId: f.incident.id,
        timelineId: source.id,
      };
      const studio = createAgentIncidentStudioServiceV1({
        reads: createAgentIncidentServiceV1({
          cursorHmacKey: new Uint8Array(32).fill(86),
          canReadIncident: () => true,
          canReadStaffIncident: () => true,
        }).staff,
        approvals: f.approvals,
        notifications: f.notifications,
        cursorHmacKey: new Uint8Array(32).fill(87),
      });
      expect(source.details.notificationRecoveryRequested).toBe(true);
      const initial = await recoveryJournal(f);
      expect(initial).toHaveLength(2);
      expect(initial.map((row) => row.details)).toMatchObject([
        {
          schemaVersion: recoverySchema,
          source: {
            timelineId: source.id,
            transitionVersion: 2,
            severity: "high",
            status: "open",
            observedAt: source.createdAt.toISOString(),
          },
          recovery: { state: "pending", attempts: 0 },
        },
        {
          schemaVersion: recoverySchema,
          recovery: {
            state: "pending",
            attempts: 1,
            lastErrorCode: "NOTIFICATION_RECORDING_FAILED",
            nextAttemptAt: new Date(f.now().getTime() + 30_000).toISOString(),
          },
        },
      ]);
      expect(initial.every((row) => row.sourceId === source.id)).toBe(true);
      expect(await f.db.select().from(npAgentNotifications)).toEqual([]);
      const facts = await executionFacts(f);
      const failureInput = {
        db: f.db,
        siteId,
        incidentId: f.incident.id,
        timelineId: source.id,
        transitionVersion: 2,
        transition: "containment_failed" as const,
      };
      await Promise.all([owners.recordFailure(failureInput), owners.recordFailure(failureInput)]);
      expect(await f.invoke(execute)).toEqual(result);
      const visible = await studio.get(identity);
      expect(visible.timeline).toHaveLength(1);
      expect(visible.timeline[0]).toMatchObject({
        id: source.id,
        notificationRecovery: { state: "pending", attempts: 1 },
      });
      expect(await owners.recoveryState(identity)).toMatchObject({ state: "pending", attempts: 1 });
      expect(await recoveryJournal(f)).toEqual(initial);
      await failLocalNotificationInserts(f, false);
      f.advance(29);
      await owners.recover({ siteId });
      expect(await recoveryJournal(f)).toEqual(initial);
      expect(await f.db.select().from(npAgentNotifications)).toEqual([]);
      await f.db
        .update(npAgentIncidents)
        .set({
          severity: "low",
          status: "resolved",
          resolvedAt: f.now(),
          resolutionCode: "HUMAN_REVIEW",
          updatedAt: f.now(),
          versionNumber: 3,
        })
        .where(eq(npAgentIncidents.id, f.incident.id));
      f.advance(1);
      await Promise.all([owners.recover({ siteId }), owners.recover({ siteId })]);
      const journal = await recoveryJournal(f);
      expect(journal).toHaveLength(3);
      expect(journal.slice(0, 2)).toEqual(initial);
      expect(journal[2].details).toMatchObject({
        source: initial[0].details.source,
        recovery: { state: "sent", attempts: 2, nextAttemptAt: null, lastErrorCode: null },
      });
      expect((await f.notifications.list({ siteId, actor: f.actor.actor })).items).toMatchObject([
        {
          incidentVersion: 2,
          severity: "high",
          status: "open",
          transition: "containment_failed",
          createdAt: source.createdAt.toISOString(),
        },
      ]);
      expect(await f.db.select().from(npAgentNotifications)).toHaveLength(1);
      expect(await f.invoke(execute)).toEqual(result);
      f.advance(3600);
      await owners.recover({ siteId });
      expect(await recoveryJournal(f)).toEqual(journal);
      expect(await executionFacts(f)).toEqual(facts);
      expect(
        (
          await f.db
            .select()
            .from(npAgentIncidentTimeline)
            .where(eq(npAgentIncidentTimeline.id, source.id))
        )[0],
      ).toEqual(source);
      const [receipt] = await f.db.select().from(npAgentNotifications);
      await f.db
        .update(npAgentNotifications)
        .set({ payloadRedacted: { ...receipt.payloadRedacted, severity: "critical" } })
        .where(eq(npAgentNotifications.id, receipt.id));
      expect(await owners.recoveryState(identity)).toBeNull();
      expect((await studio.get(identity)).timeline[0].notificationRecovery).toBeNull();
      expect((await f.notifications.list({ siteId, actor: f.actor.actor })).items).toEqual([]);
      expect(await recoveryJournal(f)).toEqual(journal);
    } finally {
      await failLocalNotificationInserts(f, false);
    }
  });

  it("bounds actual database recording failures at five append-only attempts", async () => {
    const f = await moderationFixture({
      notifications: true,
      recoverFailures: true,
      documentTarget: true,
    });
    const owners = recoveryOwners(f);
    await failLocalNotificationInserts(f, true);
    try {
      const { source, execute, result } = await rolledBackFailure(f);
      const facts = await executionFacts(f);
      for (const [index, delay] of [30, 120, 600, 1800].entries()) {
        const before = await recoveryJournal(f);
        f.advance(delay - 1);
        await owners.recover({ siteId });
        expect(await recoveryJournal(f)).toEqual(before);
        f.advance(1);
        await owners.recover({ siteId });
        const after = await recoveryJournal(f);
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after.at(-1)?.details.recovery).toMatchObject({
          attempts: index + 2,
          state: index === 3 ? "failed" : "pending",
          lastErrorCode: "NOTIFICATION_RECORDING_FAILED",
        });
      }
      const terminal = await recoveryJournal(f);
      expect(terminal).toHaveLength(6);
      expect(
        await owners.recoveryState({
          siteId,
          actor: f.actor.actor,
          incidentId: f.incident.id,
          timelineId: source.id,
        }),
      ).toMatchObject({ state: "failed", attempts: 5, nextAttemptAt: null });
      expect(await f.invoke(execute)).toEqual(result);
      await failLocalNotificationInserts(f, false);
      f.advance(86400);
      await owners.recover({ siteId });
      await owners.recordFailure({
        db: f.db,
        siteId,
        incidentId: f.incident.id,
        timelineId: source.id,
        transitionVersion: 2,
        transition: "containment_failed",
      });
      expect(await recoveryJournal(f)).toEqual(terminal);
      expect(await f.db.select().from(npAgentNotifications)).toEqual([]);
      expect(await executionFacts(f)).toEqual(facts);
    } finally {
      await failLocalNotificationInserts(f, false);
    }
  });

  it("hides recovery under current ACL or tampered evidence without repairing reads", async () => {
    const f = await moderationFixture({
      notifications: true,
      recoverFailures: true,
      documentTarget: true,
    });
    const owners = recoveryOwners(f);
    await failLocalNotificationInserts(f, true);
    try {
      const { source } = await rolledBackFailure(f);
      const identity = {
        siteId,
        actor: f.actor.actor,
        incidentId: f.incident.id,
        timelineId: source.id,
      };
      const journal = await recoveryJournal(f);
      f.denyFailureRead(true);
      expect(await owners.recoveryState(identity)).toBeNull();
      expect(await recoveryJournal(f)).toEqual(journal);
      f.denyFailureRead(false);
      await f.db
        .update(npSiteMemberships)
        .set({ role: "viewer" })
        .where(
          and(
            eq(npSiteMemberships.siteId, siteId),
            eq(npSiteMemberships.userId, f.actor.actor.user.id),
          ),
        );
      await expect(owners.recoveryState(identity)).rejects.toThrow();
      expect(await recoveryJournal(f)).toEqual(journal);
      await f.db
        .update(npSiteMemberships)
        .set({ role: "admin" })
        .where(
          and(
            eq(npSiteMemberships.siteId, siteId),
            eq(npSiteMemberships.userId, f.actor.actor.user.id),
          ),
        );
      const altered = {
        ...journal[1].details,
        recovery: {
          state: "sent",
          attempts: 1,
          lastAttemptAt: f.now().toISOString(),
          nextAttemptAt: null,
          lastErrorCode: null,
        },
      };
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ details: altered })
        .where(eq(npAgentIncidentTimeline.id, journal[1].id));
      expect(await owners.recoveryState(identity)).toBeNull();
      f.advance(30);
      await owners.recover({ siteId });
      expect(await recoveryJournal(f)).toHaveLength(2);
      expect((await recoveryJournal(f))[1].details).toEqual(altered);
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ details: journal[1].details })
        .where(eq(npAgentIncidentTimeline.id, journal[1].id));
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ sourceFingerprint: `cj1:sha256:${"A".repeat(43)}` })
        .where(eq(npAgentIncidentTimeline.id, journal[1].id));
      const malformed = await recoveryJournal(f);
      expect(await owners.recoveryState(identity)).toBeNull();
      await owners.recover({ siteId });
      expect(await recoveryJournal(f)).toEqual(malformed);
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ sourceFingerprint: journal[1].sourceFingerprint })
        .where(eq(npAgentIncidentTimeline.id, journal[1].id));
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ details: { ...source.details, executionInvocationId: randomUUID() } })
        .where(eq(npAgentIncidentTimeline.id, source.id));
      expect(await owners.recoveryState(identity)).toBeNull();
      expect(await recoveryJournal(f)).toEqual(journal);
      await owners.recover({ siteId });
      const terminal = await recoveryJournal(f);
      expect(terminal.at(-1)?.details.recovery).toMatchObject({
        state: "failed",
        attempts: 2,
        lastErrorCode: "SOURCE_EVIDENCE_INVALID",
        nextAttemptAt: null,
      });
      expect(await f.db.select().from(npAgentNotifications)).toEqual([]);
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ details: source.details })
        .where(eq(npAgentIncidentTimeline.id, source.id));
      await failLocalNotificationInserts(f, false);
      f.advance(3600);
      await owners.recover({ siteId });
      expect(await recoveryJournal(f)).toEqual(terminal);
      expect(await owners.recoveryState(identity)).toMatchObject({
        state: "failed",
        lastErrorCode: "SOURCE_EVIDENCE_INVALID",
      });
    } finally {
      await failLocalNotificationInserts(f, false);
    }
  });

  it("never backfills unmarked failure history when a recovery owner is later installed", async () => {
    const f = await moderationFixture({ notifications: true, documentTarget: true });
    expect(f.notifications.recover).toBeUndefined();
    expect(f.notifications.recordFailure).toBeUndefined();
    await failLocalNotificationInserts(f, true);
    try {
      const { source } = await rolledBackFailure(f);
      expect(source.details.notificationRecoveryRequested).toBeUndefined();
      const notifications = createAgentIncidentNotificationsServiceV1({
        reads: createAgentIncidentServiceV1({
          cursorHmacKey: new Uint8Array(32).fill(88),
          canReadIncident: () => true,
          canReadStaffIncident: () => true,
        }).staff,
        cursorHmacKey: new Uint8Array(32).fill(89),
        recoverFailures: true,
        canReviewAction: () => true,
        now: f.now,
      });
      if (!notifications.recover || !notifications.recoveryState || !notifications.recordFailure)
        throw new Error("Recovery owner required");
      await failLocalNotificationInserts(f, false);
      await notifications.recover({ siteId });
      expect(
        await notifications.recoveryState({
          siteId,
          actor: f.actor.actor,
          incidentId: f.incident.id,
          timelineId: source.id,
        }),
      ).toBeNull();
      await expect(
        notifications.recordFailure({
          db: f.db,
          siteId,
          incidentId: f.incident.id,
          timelineId: source.id,
          transitionVersion: 2,
          transition: "containment_failed",
        }),
      ).rejects.toThrow();
      expect(await recoveryJournal(f)).toEqual([]);
      expect(await f.db.select().from(npAgentNotifications)).toEqual([]);
      expect(await f.db.select().from(npAgentIncidentTimeline)).toEqual([source]);
    } finally {
      await failLocalNotificationInserts(f, false);
    }
  });

  it("journals a confirmed local notification on the initial attempt", async () => {
    const f = await moderationFixture({
      notifications: true,
      recoverFailures: true,
      documentTarget: true,
    });
    const { source } = await rolledBackFailure(f);
    const initial = await recoveryJournal(f);
    expect(initial.map((row) => row.details.recovery)).toMatchObject([
      { state: "pending", attempts: 0 },
      { state: "sent", attempts: 1 },
    ]);
    expect(
      await recoveryOwners(f).recoveryState({
        siteId,
        actor: f.actor.actor,
        incidentId: f.incident.id,
        timelineId: source.id,
      }),
    ).toMatchObject({ state: "sent", attempts: 1 });
    expect(await f.db.select().from(npAgentNotifications)).toHaveLength(1);
  });

  it.each([false, true])(
    "persists only confirmed rolled-back quarantine failure, with isolated notification failure=%s",
    async (failNotification) => {
      const f = await moderationFixture({
        notifications: true,
        failNotification,
        documentTarget: true,
      });
      const approval = required(await f.invoke(f.quarantineRequest));
      await decide(f, approval.approvalId);
      const execute = execution("moderation.quarantine", approval);
      const config = getCollectionConfig("discussions");
      const originalHooks = config.hooks;
      let deferredCalls = 0;
      config.hooks = {
        beforeUpdate: [({ data }) => ({ ...data, title: "Unexpected hook mutation" })],
        afterUpdate: [
          ({ data }) => {
            deferredCalls++;
            return data;
          },
        ],
      };
      try {
        const result = await f.invoke(execute);
        expect(result.output).toMatchObject({
          state: "failed",
          containmentId: null,
          actionId: approval.actionId,
        });
        expect(
          (
            await f.db.select().from(discussionsTable).where(eq(discussionsTable.id, f.document.id))
          )[0],
        ).toMatchObject({ title: f.document.title, status: "published" });
        expect(deferredCalls).toBe(0);
        expect(await f.db.select().from(npAgentContainments)).toEqual([]);
        const [action] = await f.db
          .select()
          .from(npAgentActions)
          .where(eq(npAgentActions.id, approval.actionId));
        expect(action).toMatchObject({
          state: "failed",
          errorCode: "CONTAINMENT_VERIFICATION_FAILED",
          verificationState: "failed",
          containmentId: null,
        });
        expect(
          (
            await f.db
              .select()
              .from(npAgentApprovals)
              .where(eq(npAgentApprovals.id, approval.approvalId))
          )[0].state,
        ).toBe("consumed");
        const [timeline] = await f.db.select().from(npAgentIncidentTimeline);
        expect(timeline).toMatchObject({
          actionId: action.id,
          kind: "action",
          details: {
            schemaVersion: "np.agent-incident-containment-failure-entry.v1",
            outcome: "rolled_back",
            transitionVersion: 2,
          },
        });
        const feed = await f.notifications.list({ siteId, actor: f.actor.actor });
        expect(feed.items).toHaveLength(failNotification ? 0 : 1);
        if (!failNotification)
          expect(feed.items[0]).toMatchObject({
            transition: "containment_failed",
            severity: "high",
            status: "open",
          });
        expect(await f.invoke(execute)).toEqual(result);
        expect(await f.db.select().from(npAgentIncidentTimeline)).toHaveLength(1);
        expect(await f.db.select().from(npAgentNotifications)).toHaveLength(
          failNotification ? 0 : 1,
        );
        await expect(f.invoke(execution("moderation.quarantine", approval))).rejects.toThrow();
      } finally {
        config.hooks = originalHooks;
      }
    },
  );

  it("records an Admin failure with replay and an authorized typed Incident timeline", async () => {
    const f = await moderationFixture({ notifications: true, documentTarget: true });
    const seeded = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    const approver: NpAgentAdminActorV1 = {
      user: {
        id: seeded.userId,
        name: seeded.name,
        email: seeded.email,
        role: seeded.role,
        tokenVersion: 0,
      },
      sessionId: session.id,
    };
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(83),
      canReadIncident: () => true,
      canReadStaffIncident: () => true,
    }).staff;
    const response = createAgentIncidentResponseServiceV1({
      reads,
      moderation: f.service,
      approvals: f.approvals,
      resolveTargets: async () => [
        { kind: "document", collection: "discussions", id: f.document.id },
      ],
      now: f.now,
      admission: {
        reauthentication: {
          verify: () => ({
            reauthenticatedAt: f.now().toISOString(),
            sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
          }),
        },
      },
    });
    const identity = { siteId, actor: f.actor.actor, incidentId: f.incident.id };
    await f.db
      .update(npAgentIncidents)
      .set({ severity: "medium" })
      .where(eq(npAgentIncidents.id, f.incident.id));
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads,
      canReviewContainment: () => true,
      notifications: f.notifications,
      now: f.now,
    });
    await workflow.escalate({
      ...identity,
      command: {
        schemaVersion: "np.agent-incident-severity-input.v1",
        expectedVersion: 1,
        severity: "high",
        note: "Staff reviewed escalation evidence.",
        idempotencyKey: randomUUID(),
      },
    });
    const choice = (await response.get(identity)).choices[0];
    await response.responsePlan({
      ...identity,
      command: {
        schemaVersion: "np.agent-incident-response-plan-input.v1",
        expectedVersion: 2,
        capabilityId: "moderation.quarantine",
        proposal: {
          incidentId: f.incident.id,
          target: choice.target,
          expectedVersionDigest: choice.expectedVersionDigest,
          reasonCode: "HUMAN_REVIEW",
        },
        idempotencyKey: randomUUID(),
      },
    });
    const plan = (await response.get(identity)).plans[0];
    await decide(f, plan.approvalId, "approve", approver);
    const command = {
      schemaVersion: "np.agent-incident-response-execute-input.v1" as const,
      expectedVersion: 2,
      actionId: plan.actionId,
      approvalId: plan.approvalId,
      proposalHash: plan.proposalHash,
      idempotencyKey: randomUUID(),
    };
    const config = getCollectionConfig("discussions"),
      originalHooks = config.hooks;
    config.hooks = { beforeUpdate: [({ data }) => ({ ...data, title: "Unexpected mutation" })] };
    try {
      expect(await response.responseExecute({ ...identity, command })).toMatchObject({
        replayed: false,
      });
      expect(await response.responseExecute({ ...identity, command })).toMatchObject({
        replayed: true,
      });
      expect((await response.get(identity)).plans[0]).toMatchObject({
        state: "failed",
        canExecute: false,
      });
      const studio = createAgentIncidentStudioServiceV1({
        reads,
        approvals: f.approvals,
        cursorHmacKey: new Uint8Array(32).fill(84),
      });
      expect(
        (await studio.get(identity)).timeline.find((entry) => entry.kind === "action")
          ?.containmentFailure,
      ).toEqual({
        outcome: "rolled_back",
        reasonCode: "CONTAINMENT_VERIFICATION_FAILED",
      });
      const hidden = createAgentIncidentStudioServiceV1({
        reads,
        cursorHmacKey: new Uint8Array(32).fill(85),
      });
      expect(
        (await hidden.get(identity)).timeline.filter((entry) => entry.kind === "action"),
      ).toEqual([]);
      expect(
        (await f.notifications.list({ siteId, actor: f.actor.actor })).items
          .map((item) => item.transition)
          .sort(),
      ).toEqual(["containment_failed", "escalated"]);
      const [entry] = await f.db
        .select()
        .from(npAgentIncidentTimeline)
        .where(eq(npAgentIncidentTimeline.actionId, plan.actionId));
      await f.db
        .update(npAgentIncidentTimeline)
        .set({
          details: { ...entry.details, executionInvocationId: randomUUID() },
        })
        .where(eq(npAgentIncidentTimeline.id, entry.id));
      expect(
        (await f.notifications.list({ siteId, actor: f.actor.actor })).items.filter(
          (item) => item.transition === "containment_failed",
        ),
      ).toEqual([]);
      expect(
        (await studio.get(identity)).timeline.filter((entry) => entry.kind === "action"),
      ).toEqual([]);
      await f.db
        .update(npAgentIncidentTimeline)
        .set({ details: entry.details })
        .where(eq(npAgentIncidentTimeline.id, entry.id));
      await f.db
        .update(npAgentActions)
        .set({ verificationEvidence: [{ outcome: "unknown" }] })
        .where(eq(npAgentActions.id, plan.actionId));
      expect(
        (await studio.get(identity)).timeline.filter((entry) => entry.kind === "action"),
      ).toEqual([]);
      await expect(
        f.db.transaction((db) =>
          f.incidents.appendFailedContainmentEvent({
            db,
            siteId,
            incidentId: f.incident.id,
            actionId: plan.actionId,
            auditEventId: entry.auditEventId!,
          }),
        ),
      ).rejects.toThrow();
    } finally {
      config.hooks = originalHooks;
    }
  });

  it("keeps denied action targets out of failed-containment notifications", async () => {
    const f = await moderationFixture({
      notifications: true,
      denyFailureRead: true,
      documentTarget: true,
    });
    const approval = required(await f.invoke(f.quarantineRequest));
    await decide(f, approval.approvalId);
    const config = getCollectionConfig("discussions"),
      originalHooks = config.hooks;
    config.hooks = { beforeUpdate: [({ data }) => ({ ...data, title: "Unexpected mutation" })] };
    try {
      expect((await f.invoke(execution("moderation.quarantine", approval))).output.state).toBe(
        "failed",
      );
      expect(await f.db.select().from(npAgentNotifications)).toHaveLength(1);
      expect((await f.notifications.list({ siteId, actor: f.actor.actor })).items).toEqual([]);
    } finally {
      config.hooks = originalHooks;
    }
  });

  it("does not classify unknown hook errors or rejected approvals as failed containment", async () => {
    const f = await moderationFixture({ notifications: true, documentTarget: true });
    const approval = required(await f.invoke(f.quarantineRequest));
    await decide(f, approval.approvalId);
    const config = getCollectionConfig("discussions"),
      originalHooks = config.hooks;
    config.hooks = {
      beforeUpdate: [
        () => {
          throw new Error("Unknown host error");
        },
      ],
    };
    try {
      await expect(f.invoke(execution("moderation.quarantine", approval))).rejects.toThrow(
        "Unknown host error",
      );
    } finally {
      config.hooks = originalHooks;
    }
    await assertUntouched(f);
    await decide(f, approval.approvalId, "revoke");
    await expect(f.invoke(execution("moderation.quarantine", approval))).rejects.toThrow();
    expect(await f.db.select().from(npAgentIncidentTimeline)).toEqual([]);
    expect(await f.db.select().from(npAgentNotifications)).toEqual([]);
  });

  it("uses real staff plans, distinct human approval, exact execution and restoration without a Gateway run", async () => {
    const f = await moderationFixture();
    const seeded = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    const approver: NpAgentAdminActorV1 = {
      user: {
        id: seeded.userId,
        name: seeded.name,
        email: seeded.email,
        role: seeded.role,
        tokenVersion: 0,
      },
      sessionId: session.id,
    };
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(84),
      canReadIncident: () => true,
      canReadStaffIncident: () => true,
    }).staff;
    const response = createAgentIncidentResponseServiceV1({
      reads,
      moderation: f.service,
      approvals: f.approvals,
      resolveTargets: async ({ incident }) =>
        incident.primarySubject?.kind === "comment"
          ? [
              {
                kind: "comment",
                collection: incident.primarySubject.collection,
                id: incident.primarySubject.commentId,
              },
            ]
          : [],
      now: f.now,
      admission: {
        reauthentication: {
          verify: () => ({
            reauthenticatedAt: f.now().toISOString(),
            sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
          }),
        },
      },
    });
    const identity = { siteId, actor: f.actor.actor, incidentId: f.incident.id };
    const view = await response.get(identity);
    expect(view.choices).toHaveLength(1);
    const command = {
      schemaVersion: "np.agent-incident-response-plan-input.v1" as const,
      expectedVersion: 1,
      capabilityId: "moderation.quarantine" as const,
      proposal: {
        incidentId: f.incident.id,
        target: view.choices[0].target,
        expectedVersionDigest: view.choices[0].expectedVersionDigest,
        reasonCode: "HUMAN_REVIEW",
      },
      idempotencyKey: randomUUID(),
    };
    expect(await response.responsePlan({ ...identity, command })).toEqual({
      resourceId: f.incident.id,
      replayed: false,
    });
    expect(await response.responsePlan({ ...identity, command })).toMatchObject({ replayed: true });
    const plan = (await response.get(identity)).plans[0];
    expect(plan.state).toBe("approval_pending");
    expect(plan.canExecute).toBe(false);
    expect(await f.db.select().from(npAgentRuns)).toEqual([]);
    const [action] = await f.db.select().from(npAgentActions);
    expect(action).toMatchObject({ runId: null, runFingerprint: null });
    const [inv] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, action.invocationId!));
    expect(inv).toMatchObject({
      actorKind: "staff",
      operationKind: "admin",
      principalId: null,
      capabilityDefinitionBody: null,
      effectProfileId: null,
    });
    await expect(decide(f, plan.approvalId)).rejects.toThrow();
    await decide(f, plan.approvalId, "approve", approver);
    expect((await response.get(identity)).plans[0].canExecute).toBe(true);
    const execute = {
      schemaVersion: "np.agent-incident-response-execute-input.v1" as const,
      expectedVersion: 1,
      actionId: plan.actionId,
      approvalId: plan.approvalId,
      proposalHash: plan.proposalHash,
      idempotencyKey: randomUUID(),
    };
    await expect(
      response.responsePlan({
        ...identity,
        command: {
          ...command,
          idempotencyKey: randomUUID(),
          proposal: {
            ...command.proposal,
            target: { ...command.proposal.target, id: randomUUID() },
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      response.responseExecute({ ...identity, command: { ...execute, expectedVersion: 2 } }),
    ).rejects.toThrow();
    f.budget.directActionsPerHour += 1;
    expect((await response.get(identity)).plans[0].canExecute).toBe(false);
    await expect(response.responseExecute({ ...identity, command: execute })).rejects.toThrow();
    f.budget.directActionsPerHour -= 1;
    await f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(
        and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, approver.user.id)),
      );
    expect((await response.get(identity)).plans[0].canExecute).toBe(false);
    await expect(response.responseExecute({ ...identity, command: execute })).rejects.toThrow();
    await f.db
      .update(npSiteMemberships)
      .set({ role: "admin" })
      .where(
        and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, approver.user.id)),
      );
    await f.db
      .update(npComments)
      .set({ bodyMd: "Changed after approval" })
      .where(eq(npComments.id, f.comment.id));
    expect((await response.get(identity)).plans[0].canExecute).toBe(false);
    await expect(response.responseExecute({ ...identity, command: execute })).rejects.toThrow();
    await f.db
      .update(npComments)
      .set({ bodyMd: f.comment.bodyMd })
      .where(eq(npComments.id, f.comment.id));
    expect(
      (
        await f.db.select().from(npAgentApprovals).where(eq(npAgentApprovals.id, plan.approvalId))
      )[0].state,
    ).toBe("approved");
    await response.responseExecute({ ...identity, command: execute });
    expect(await response.responseExecute({ ...identity, command: execute })).toMatchObject({
      replayed: true,
    });
    const restoredView = await response.get(identity);
    expect(restoredView.choices.some((c) => c.capabilityId === "moderation.quarantine")).toBe(
      false,
    );
    const choice = restoredView.choices.find((c) => c.capabilityId === "moderation.restore")!;
    expect(choice).toBeDefined();
    const current = (await reads.get({ incidentId: f.incident.id }, identity)).incident;
    await response.responsePlan({
      ...identity,
      command: {
        schemaVersion: "np.agent-incident-response-plan-input.v1",
        expectedVersion: current.versionNumber,
        capabilityId: "moderation.restore",
        proposal: {
          containmentKind: "content_quarantine",
          containmentId: choice.containmentId!,
          expectedVersionDigest: choice.expectedVersionDigest,
        },
        idempotencyKey: randomUUID(),
      },
    });
    const restoration = (await response.get(identity)).plans.find(
      (p) => p.capabilityId === "moderation.restore",
    )!;
    await decide(f, restoration.approvalId, "approve", approver);
    await response.restore({
      ...identity,
      command: {
        schemaVersion: "np.agent-incident-response-execute-input.v1",
        expectedVersion: current.versionNumber,
        actionId: restoration.actionId,
        approvalId: restoration.approvalId,
        proposalHash: restoration.proposalHash,
        idempotencyKey: randomUUID(),
      },
    });
    expect(
      (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0].status,
    ).toBe("pending");
    expect(await f.db.select().from(npAgentRuns)).toEqual([]);
    await f.db.delete(npSessions).where(eq(npSessions.id, identity.actor.sessionId));
    await expect(response.responseExecute({ ...identity, command: execute })).rejects.toThrow();
  });
  it("requires human approval, quarantines and restores pending content with stable replay and retained reviews", async () => {
    const f = await moderationFixture();
    f.budget.providerCallsPerRun = 0;
    const projected = await f.admission.project({ authentication: f.principal.authentication });
    expect(projected.entries.map((entry) => entry.definition.descriptor.id)).toEqual(
      expect.arrayContaining(["moderation.quarantine", "moderation.restore"]),
    );
    const proposed = await f.invoke(f.quarantineRequest);
    const approval = required(proposed);
    expect(await f.invoke(f.quarantineRequest)).toEqual(proposed);
    const execute = execution("moderation.quarantine", approval);
    await expect(f.invoke(execute)).rejects.toThrow();
    await assertUntouched(f);
    const reviewed = await decide(f, approval.approvalId);
    expect(reviewed.actionReview).toMatchObject({
      actionId: approval.actionId,
      target: { kind: "comment", collection: "discussions", id: f.comment.id },
      reasonCode: "REPEATED_LINK_SPAM",
    });
    const quarantined = await f.invoke(execute);
    if (quarantined.output.state !== "succeeded") throw new Error("Quarantine failed");
    expect(await f.invoke(execute)).toEqual(quarantined);
    expect(
      (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0],
    ).toMatchObject({ status: "hidden", bodyMd: f.comment.bodyMd });
    expect(
      (await f.approvals.get({ siteId, actor: f.actor.actor, id: approval.approvalId })).item
        .approval.state,
    ).toBe("consumed");
    const [containment] = await f.db
      .select()
      .from(npAgentContainments)
      .where(eq(npAgentContainments.id, quarantined.output.containmentId));
    await assertRetained(f, approval.actionId, approval.approvalId);
    const restore = required(
      await f.invoke({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "moderation.restore",
        arguments: {
          idempotencyKey: randomUUID(),
          input: {
            mode: "propose",
            proposal: {
              containmentKind: "content_quarantine",
              containmentId: containment.id,
              expectedVersionDigest: containment.targetVersionDigest,
            },
          },
        },
      }),
    );
    await decide(f, restore.approvalId);
    const restoreExecute = execution("moderation.restore", restore);
    const restored = await f.invoke(restoreExecute);
    expect(restored.output.state).toBe("compensated");
    await assertRetained(f, approval.actionId, approval.approvalId);
    expect(await f.invoke(restoreExecute)).toEqual(restored);
    expect(
      (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0],
    ).toEqual(f.comment);
    expect(
      (await f.approvals.get({ siteId, actor: f.actor.actor, id: restore.approvalId })).item
        .approval.state,
    ).toBe("consumed");
    expect(
      (
        await f.db
          .select()
          .from(npAgentContainments)
          .where(eq(npAgentContainments.id, containment.id))
      )[0],
    ).toMatchObject({ state: "restored", restoreActionId: restore.actionId });
    expect(
      (
        await f.db
          .select()
          .from(npAgentIncidentTimeline)
          .where(eq(npAgentIncidentTimeline.incidentId, f.incident.id))
      )
        .map((row) => row.actionId)
        .sort(),
    ).toEqual([approval.actionId, restore.actionId].sort());
    const incidentReads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(71),
      canReadIncident: () => false,
      canReadStaffIncident: () => true,
    });
    const studio = createAgentIncidentStudioServiceV1({
      reads: incidentReads.staff,
      approvals: f.approvals,
      activity: createAgentActivityServiceV1({ cursorHmacKey: new Uint8Array(32).fill(72) }),
      cursorHmacKey: new Uint8Array(32).fill(73),
    });
    const detail = await studio.get({ siteId, actor: f.actor.actor, incidentId: f.incident.id });
    expect(detail.timeline.map((entry) => entry.approvalId).sort()).toEqual(
      [approval.approvalId, restore.approvalId].sort(),
    );
    expect(detail.feedbackAvailable).toBe(false);

    expect((await f.db.select().from(npAgentActions)).map((row) => row.state)).toEqual([
      "compensated",
      "compensated",
    ]);
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(
          and(eq(npAuditEvents.targetId, f.comment.id), eq(npAuditEvents.action, "comment.hide")),
        ),
    ).toHaveLength(1);
  });

  it("requires current containment review and visibility to close, prevents new quarantine, and preserves approved restoration after closure", async () => {
    const f = await moderationFixture();
    let visible = true;
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(76),
      canReadIncident: () => false,
      canReadStaffIncident: () => true,
    }).staff;
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads,
      now: f.now,
      canReviewContainment: () => visible,
      canReviewAction: () => visible,
    });
    const input = { siteId, actor: f.actor.actor, incidentId: f.incident.id };
    const initial = await workflow.get(input);
    const approval = required(await f.invoke(f.quarantineRequest));
    const pending = await workflow.get(input);
    expect(pending.containment).toMatchObject({ total: 0, pendingActions: 1 });
    expect(pending.availableTransitions).toEqual(["investigating"]);
    const closeCommand = {
      schemaVersion: "np.agent-incident-transition-input.v1" as const,
      expectedVersion: 1,
      transition: "resolved" as const,
      resolutionCode: "REMEDIATED" as const,
      note: "Reviewed remaining containment; retain until approved restoration.",
      containmentReviewHash: initial.containment.reviewHash,
      containmentDisposition: "retain" as const,
      idempotencyKey: randomUUID(),
    };
    await expect(workflow.transition({ ...input, command: closeCommand })).rejects.toMatchObject({
      code: "INCIDENT_TRANSITION_INVALID",
    });
    const noActionOwner = createAgentIncidentWorkflowServiceV1({
      reads,
      canReviewContainment: () => true,
    });
    await expect(noActionOwner.get(input)).rejects.toMatchObject({
      code: "INCIDENT_WORKFLOW_FORBIDDEN",
    });
    await decide(f, approval.approvalId);
    const execute = execution("moderation.quarantine", approval);
    const quarantined = await f.invoke(execute);
    if (quarantined.output.state !== "succeeded") throw new Error("Quarantine failed");
    const containmentId = quarantined.output.containmentId;
    const [containment] = await f.db
      .select()
      .from(npAgentContainments)
      .where(eq(npAgentContainments.id, containmentId));
    const review = await workflow.get(input);
    expect(review.containment).toMatchObject({
      total: 1,
      active: 1,
      restored: 0,
      unresolved: 0,
      pendingActions: 0,
    });
    // The retained row changes without an Incident version bump; the digest must still reject the old review.
    await f.db
      .update(npAgentContainments)
      .set({ expiresAt: new Date(containment.createdAt.getTime() + 86400000) })
      .where(eq(npAgentContainments.id, containment.id));
    await expect(
      workflow.transition({
        ...input,
        command: {
          ...closeCommand,
          expectedVersion: 2,
          containmentReviewHash: review.containment.reviewHash,
        },
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_CONTAINMENT_REVIEW_STALE" });
    visible = false;
    await expect(workflow.get(input)).rejects.toMatchObject({
      code: "INCIDENT_WORKFLOW_FORBIDDEN",
    });
    visible = true;
    const current = await workflow.get(input);
    await expect(
      workflow.transition({
        ...input,
        command: {
          ...closeCommand,
          expectedVersion: 2,
          containmentReviewHash: current.containment.reviewHash,
          containmentDisposition: "acknowledge",
        },
      }),
    ).rejects.toMatchObject({ code: "INCIDENT_CONTAINMENT_REVIEW_REQUIRED" });
    const closed = {
      ...input,
      command: {
        ...closeCommand,
        expectedVersion: 2,
        containmentReviewHash: current.containment.reviewHash,
      },
    };
    await workflow.transition(closed);
    expect((await workflow.transition(closed)).replayed).toBe(true);
    visible = false;
    await expect(workflow.transition(closed)).rejects.toMatchObject({
      code: "INCIDENT_WORKFLOW_FORBIDDEN",
    });
    visible = true;
    expect(
      (
        await f.db
          .select()
          .from(npAgentContainments)
          .where(eq(npAgentContainments.id, containment.id))
      )[0].state,
    ).toBe("active");
    expect(
      (await f.db.select().from(npComments).where(eq(npComments.id, f.comment.id)))[0].status,
    ).toBe("hidden");
    expect(await f.invoke(execute)).toEqual(quarantined);
    const restore = required(
      await f.invoke({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "moderation.restore",
        arguments: {
          idempotencyKey: randomUUID(),
          input: {
            mode: "propose",
            proposal: {
              containmentKind: "content_quarantine",
              containmentId: containment.id,
              expectedVersionDigest: containment.targetVersionDigest,
            },
          },
        },
      }),
    );
    expect((await workflow.get(input)).containment.pendingActions).toBe(1);
    await decide(f, restore.approvalId);
    expect((await f.invoke(execution("moderation.restore", restore))).output.state).toBe(
      "compensated",
    );
    expect((await workflow.get(input)).containment).toMatchObject({
      total: 1,
      active: 0,
      restored: 1,
      unresolved: 0,
      pendingActions: 0,
    });
    expect(
      (await f.db.select().from(npAgentIncidents).where(eq(npAgentIncidents.id, f.incident.id)))[0]
        .status,
    ).toBe("resolved");
    // Restored content has its original version; only the terminal Incident guard rejects a fresh proposal.
    const fresh = structuredClone(f.quarantineRequest);
    fresh.arguments.idempotencyKey = randomUUID();
    await expect(f.invoke(fresh)).rejects.toThrow();
  });

  it("serializes closure against a concurrent quarantine proposal", async () => {
    const f = await moderationFixture();
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(77),
      canReadIncident: () => false,
      canReadStaffIncident: () => true,
    }).staff;
    const workflow = createAgentIncidentWorkflowServiceV1({
      reads,
      now: f.now,
      canReviewContainment: () => true,
      canReviewAction: () => true,
    });
    const input = { siteId, actor: f.actor.actor, incidentId: f.incident.id };
    const review = await workflow.get(input);
    const results = await Promise.allSettled([
      workflow.transition({
        ...input,
        command: {
          schemaVersion: "np.agent-incident-transition-input.v1",
          expectedVersion: 1,
          transition: "dismissed",
          resolutionCode: "OUT_OF_SCOPE",
          note: "Reviewed current evidence.",
          containmentReviewHash: review.containment.reviewHash,
          containmentDisposition: "acknowledge",
          idempotencyKey: randomUUID(),
        },
      }),
      f.invoke(f.quarantineRequest),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [incident] = await f.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.id, f.incident.id));
    const actions = await f.db.select().from(npAgentActions);
    if (incident.status === "dismissed") expect(actions).toHaveLength(0);
    else {
      expect(incident.status).toBe("open");
      expect(actions).toHaveLength(1);
    }
    expect(await f.db.select().from(npAgentContainments)).toHaveLength(0);
  });

  it.each(["revoked", "expired", "policy-changed", "budget-changed", "target-edited"] as const)(
    "rejects %s approval execution without applying containment",
    async (condition) => {
      const f = await moderationFixture();
      const approval = required(await f.invoke(f.quarantineRequest));
      const detail = await decide(f, approval.approvalId);
      if (condition === "revoked") await decide(f, approval.approvalId, "revoke");
      if (condition === "expired") f.advance(960);
      if (condition === "policy-changed") f.rules.automation.moderationTargetsPerRun = 2;
      if (condition === "budget-changed") {
        for (const ceiling of ["attemptsPerRun", "capabilityCallsPerRun"] as const) {
          const previous = f.budget[ceiling];
          f.budget[ceiling] = 0;
          await expect(f.invoke(execution("moderation.quarantine", approval))).rejects.toThrow();
          await assertUntouched(f, detail);
          f.budget[ceiling] = previous;
        }
        f.budget.directActionsPerHour = 0;
      }
      if (condition === "target-edited")
        await f.db
          .update(npComments)
          .set({ bodyMd: "Human corrected pending content", editedAt: new Date() })
          .where(eq(npComments.id, f.comment.id));
      await expect(f.invoke(execution("moderation.quarantine", approval))).rejects.toThrow();
      await assertUntouched(f, condition === "revoked" ? undefined : detail);
      expect(await f.db.select().from(npAgentIncidentTimeline)).toEqual([]);
    },
  );

  it("rejects foreign-site targets and changed requests under an existing idempotency key", async () => {
    const f = await moderationFixture();
    const proposed = await f.invoke(f.quarantineRequest);
    const changed = structuredClone(f.quarantineRequest);
    if (
      changed.capabilityId !== "moderation.quarantine" ||
      changed.arguments.input.mode !== "propose"
    )
      throw new Error("Bad request fixture");
    changed.arguments.input.proposal.reasonCode = "OTHER_REASON";
    await expect(f.invoke(changed)).rejects.toThrow();
    expect(await f.invoke(f.quarantineRequest)).toEqual(proposed);
    const [foreign] = await f.db
      .insert(npComments)
      .values({ ...f.comment, id: randomUUID(), siteId: "draft-other" })
      .returning();
    changed.arguments.idempotencyKey = randomUUID();
    changed.arguments.input.proposal.target.id = foreign.id;
    await expect(f.invoke(changed)).rejects.toThrow();
    await assertUntouched(f);
    expect(await f.db.select().from(npAgentActions)).toHaveLength(1);
  });

  it("rolls back approval consumption, content, containment and execution evidence after a dependent write fails", async () => {
    const f = await moderationFixture();
    const approval = required(await f.invoke(f.quarantineRequest));
    const detail = await decide(f, approval.approvalId);
    const execute = execution("moderation.quarantine", approval);
    const before = await f.db.select().from(npAgentInvocations);
    f.failTimeline(true);
    await expect(f.invoke(execute)).rejects.toThrow("Incident timeline persistence failed");
    await assertUntouched(f, detail);
    expect(await f.db.select().from(npAgentInvocations)).toEqual(before);
    expect(
      (await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, approval.actionId)))[0],
    ).toMatchObject({ state: "approved", executionInvocationId: null, containmentId: null });
    expect(
      await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.targetId, f.comment.id)),
    ).toEqual([]);
    f.failTimeline(false);
    expect((await f.invoke(execute)).output.state).toBe("succeeded");
  });
  it.each(["target-invalidated", "expired"] as const)(
    "records %s maintenance without executing content and preserves terminal review",
    async (condition) => {
      const f = await moderationFixture();
      const approval = required(await f.invoke(f.quarantineRequest));
      await decide(f, approval.approvalId);
      const expired = condition === "expired";
      if (expired) {
        f.advance(960);
        expect(await f.approvals.reconcileExpired({ siteId })).toEqual({ examined: 1, expired: 1 });
      } else {
        await f.db
          .update(npComments)
          .set({ bodyMd: "Human corrected the pending comment" })
          .where(eq(npComments.id, f.comment.id));
        expect(await f.approvals.reconcile({ siteId })).toMatchObject({ examined: 1, revoked: 1 });
      }
      const errorCode = expired ? "APPROVAL_EXPIRED" : "APPROVAL_REVOKED";
      const state = expired ? "expired" : "revoked";
      expect(
        (await f.approvals.get({ siteId, actor: f.actor.actor, id: approval.approvalId })).item,
      ).toMatchObject({ approval: { state }, allowedDecisions: [] });
      expect(
        (
          await f.db.select().from(npAgentActions).where(eq(npAgentActions.id, approval.actionId))
        )[0],
      ).toMatchObject({ state: "failed", errorCode });
      expect(
        (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, approval.runId)))[0],
      ).toMatchObject({ state: "failed", errorCode, errorMessage: expect.any(String) });
      await expect(f.invoke(execution("moderation.quarantine", approval))).rejects.toThrow();
      await assertUntouched(f);
    },
  );
  it("rechecks the distinct human approver's current site authority before execution", async () => {
    const f = await moderationFixture();
    const seeded = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    const approver: NpAgentAdminActorV1 = {
      user: {
        id: seeded.userId,
        name: seeded.name,
        email: seeded.email,
        role: seeded.role,
        tokenVersion: 0,
      },
      sessionId: session.id,
    };
    const approval = required(await f.invoke(f.quarantineRequest));
    const detail = await decide(f, approval.approvalId, "approve", approver);
    await f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(
        and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, seeded.userId)),
      );
    await expect(f.invoke(execution("moderation.quarantine", approval))).rejects.toThrow();
    await assertUntouched(f, detail);
    expect(await f.approvals.reconcile({ siteId })).toMatchObject({ revoked: 1 });
    expect(
      (
        await f.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, approval.approvalId))
      )[0],
    ).toMatchObject({ state: "revoked" });
  });
});
