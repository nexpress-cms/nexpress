import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentInvocations,
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

async function moderationFixture() {
  let time = new Date();
  let failTimeline = false;
  const f = await fixture();
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
  const incidents = createAgentIncidentWriteServiceV1({
    resolveEvidence: () => false,
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
    canReadIncident: () => Promise.resolve(true),
    incidents: {
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
      severity: "medium",
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
  const target = { kind: "comment" as const, collection: "discussions", id: comment.id };
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
  };
}
type Fixture = Awaited<ReturnType<typeof moderationFixture>>;
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
