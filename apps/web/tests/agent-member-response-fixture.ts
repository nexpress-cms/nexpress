import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import { npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { npAgentApprovals } from "../../../packages/core/src/db/schema/agent.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentMemberReportIncidentWriteServiceV1,
  createAgentModeratorMemberReportObserverV1,
  createAgentModeratorMemberReportCollectorV1,
  npResolveAgentModeratorMemberReportEvidenceV1,
} from "../../../packages/core/src/agent/moderator-member-report-source.js";
import { npAgentModeratorWindowStartedAtV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import { setCommunityMemberReportObserverV1 } from "../../../packages/core/src/community/member-report-observer.js";
import { fileReport } from "../../../packages/core/src/community/reports.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentMemberReportEvidenceServiceV1 } from "../../../packages/core/src/agent/incident-member-report-evidence-service.js";
import {
  createAgentMemberResponseServiceV1,
  type NpAgentMemberResponsePolicyV1,
} from "../../../packages/core/src/agent/member-response-service.js";
import { createAgentApprovalServiceV1 } from "../../../packages/core/src/agent/approval-service.js";
import { createAgentApprovalActionTargetRouterV1 } from "../../../packages/core/src/agent/approval-action-targets.js";
import type { NpAgentAdminActorV1 } from "../../../packages/core/src/agent/admin-admission.js";
import type { NpAgentMemberResponseOperationV1 } from "../../../packages/core/src/agent-contract/member-response-contract.js";
import { getTestDb, seedActiveMember, seedUser } from "./harness.js";

export async function memberResponseFixture() {
  const db = await getTestDb();
  async function staff(): Promise<NpAgentAdminActorV1> {
    const { userId } = await seedUser({ role: "admin" });
    const [session] = await db.select().from(npSessions).where(eq(npSessions.userId, userId));
    const [user] = await db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
      })
      .from(npUsers)
      .where(eq(npUsers.id, userId));
    return { user: npRequireAuthUser(user), sessionId: session.id };
  }
  const actor = await staff();
  const approver = await staff();
  const target = await seedActiveMember({ handle: `member-${randomUUID().slice(0, 10)}` });
  const reporters = await Promise.all(
    Array.from({ length: 3 }, () =>
      seedActiveMember({ handle: `reporter-${randomUUID().slice(0, 10)}` }),
    ),
  );
  const never = () =>
    Promise.reject(new Error("Member fixture must not invoke Runtime or providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "member-response-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: ["site:read"],
    },
    enqueueRun: never,
  });
  setCommunityMemberReportObserverV1(createAgentModeratorMemberReportObserverV1({ events }));
  const reports = [];
  for (const reporter of reporters)
    reports.push(
      await withCurrentSite("default", () =>
        fileReport({
          targetType: "member",
          targetId: target.memberId,
          reporterId: reporter.memberId,
          reason: "Fixture unverified Member claim",
        }),
      ),
    );
  const windowStartedAt = npAgentModeratorWindowStartedAtV1(reports[0].createdAt.toISOString());
  if (
    reports.some(
      (report) =>
        npAgentModeratorWindowStartedAtV1(report.createdAt.toISOString()) !== windowStartedAt,
    )
  )
    throw new Error(
      "Member response fixture crossed a collection window; retry the test with fresh reports",
    );
  let time = new Date(Date.parse(windowStartedAt) + 600100);
  const now = () => new Date(time);
  const writer = createAgentMemberReportIncidentWriteServiceV1({
    now,
    resolveEvidence: ({ db, candidate }) =>
      npResolveAgentModeratorMemberReportEvidenceV1({ db, candidate, staffUserId: actor.user.id }),
  });
  const collector = createAgentModeratorMemberReportCollectorV1({
    staffUserId: actor.user.id,
    now,
    incidents: writer,
  });
  const collected = await collector.collect({ siteId: "default", windowStartedAt });
  const incidentId = collected.observations[0]?.incidentId;
  if (!incidentId) throw new Error("Expected actual Member report Incident");
  let evidence: ReturnType<typeof createAgentIncidentMemberReportEvidenceServiceV1>;
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(91),
    now,
    canReadIncident: () => false,
    canReadStaffIncident: (input) => evidence.canReadStaffIncident(input),
  }).staff;
  evidence = createAgentIncidentMemberReportEvidenceServiceV1({
    reads,
    cursorHmacKey: new Uint8Array(32).fill(92),
    now,
  });
  let currentPolicy: NpAgentMemberResponsePolicyV1 | null = {
    policyDigest: `cj1:sha256:${"A".repeat(43)}`,
    maximumDurationSeconds: 3600,
    approvalLifetimeSeconds: 600,
  };
  let recent = true;
  let approverVisible = true;
  const reauthentication = {
    verify: () =>
      recent
        ? {
            reauthenticatedAt: now().toISOString(),
            sessionFactFingerprint: `cj1:sha256:${"B".repeat(43)}`,
          }
        : false,
  };
  let approvals: ReturnType<typeof createAgentApprovalServiceV1>;
  const service = createAgentMemberResponseServiceV1({
    reads,
    memberEvidence: evidence,
    resolveApprovals: () => approvals,
    resolvePolicy: async () => currentPolicy,
    canReviewIncidentAsStaffUser: () => approverVisible,
    admission: { reauthentication },
    now,
  });
  const targetRouter = createAgentApprovalActionTargetRouterV1({
    owners: [
      {
        capabilityIds: ["moderation.member.restrict", "moderation.member.revoke"],
        resolve: () => service.approvalTargets,
      },
    ],
  });
  approvals = createAgentApprovalServiceV1({
    targets: targetRouter,
    now,
    reauthentication,
    cursorKey: new Uint8Array(32).fill(93),
    integrityKeys: {
      active: {
        owner: "approval-integrity",
        id: "member-response-test-integrity",
        bytes: new Uint8Array(32).fill(94),
      },
    },
    challengeKeys: {
      active: { id: "member-response-test-challenge", key: new Uint8Array(32).fill(95) },
    },
    secretRequestDigestKey: { id: "member-response-test-secret", key: new Uint8Array(32).fill(96) },
  });
  const input = { siteId: "default", actor, incidentId };
  async function decide(
    approvalId: string,
    viewer = approver,
    decision: "approve" | "reject" | "revoke" = "approve",
  ) {
    const identity = { siteId: input.siteId, actor: viewer, id: approvalId };
    const detail = await approvals.get(identity);
    const challenge = await approvals.issueChallenge({
      ...identity,
      command: {
        schemaVersion: "np.agent-approval-challenge-request.v1",
        purpose: decision,
        expectedApprovalVersion: detail.item.version,
        statementHash: detail.item.statementHash,
        idempotencyKey: randomUUID(),
      },
    });
    return approvals.decide({
      ...identity,
      decision,
      command: {
        schemaVersion: "np.agent-approval-decision-input.v1",
        expectedApprovalVersion: challenge.approvalVersion,
        statementHash: detail.item.statementHash,
        challengeGeneration: challenge.challengeGeneration,
        challenge: challenge.challenge,
        idempotencyKey: randomUUID(),
        reason: "Reviewed current exact site restriction facts",
      },
    });
  }
  async function plan(
    operation: NpAgentMemberResponseOperationV1 = { kind: "restrict", durationSeconds: 600 },
    requester = actor,
  ) {
    const current = await service.get({ ...input, actor: requester });
    const command = {
      schemaVersion: "np.agent-member-response-plan-input.v1" as const,
      expectedVersion: current.incidentVersion,
      memberId: current.memberId,
      expectedMemberVersionDigest: current.memberVersionDigest,
      operation,
      idempotencyKey: randomUUID(),
    };
    const result = await service.plan({ ...input, actor: requester, command });
    const [approval] = await db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.targetActionId, result.resourceId));
    if (!approval) throw new Error("Expected exact Member action Approval");
    const execute = {
      schemaVersion: "np.agent-member-response-execute-input.v1" as const,
      expectedVersion: current.incidentVersion,
      actionId: result.resourceId,
      approvalId: approval.id,
      proposalHash: approval.planHash,
      idempotencyKey: randomUUID(),
    };
    return { current, command, result, approval, execute };
  }
  return {
    db,
    actor,
    approver,
    staff,
    target,
    reports,
    reads,
    evidence,
    service,
    approvals,
    input,
    now,
    plan,
    decide,
    setTime: (value: Date) => {
      time = value;
    },
    setPolicy: (value: NpAgentMemberResponsePolicyV1 | null) => {
      currentPolicy = value;
    },
    setRecent: (value: boolean) => {
      recent = value;
    },
    setApproverVisible: (value: boolean) => {
      approverVisible = value;
    },
  };
}
