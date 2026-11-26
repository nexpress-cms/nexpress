import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import { npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { npMemberSessions } from "../../../packages/core/src/db/schema/community.js";
import { npAgentApprovals } from "../../../packages/core/src/db/schema/agent.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentGuardianObservationServiceV1 } from "../../../packages/core/src/agent/guardian-observation-service.js";
import {
  createAgentGuardianSessionObservationServiceV1,
  npReadGuardianSessionIncidentEvidenceV1,
} from "../../../packages/core/src/agent/guardian-session-observation.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import {
  createAgentGuardianSessionServiceV1,
  type NpAgentGuardianSessionPolicyV1,
} from "../../../packages/core/src/agent/guardian-session-service.js";
import { createAgentApprovalServiceV1 } from "../../../packages/core/src/agent/approval-service.js";
import { createAgentApprovalActionTargetRouterV1 } from "../../../packages/core/src/agent/approval-action-targets.js";
import type { NpAgentAdminActorV1 } from "../../../packages/core/src/agent/admin-admission.js";
import { getTestDb, seedActiveMember, seedUser } from "./harness.js";

export async function guardianSessionFixture(
  options: { audience?: "staff" | "member"; ownSession?: boolean } = {},
) {
  const db = await getTestDb();
  async function staff(superAdmin = false): Promise<NpAgentAdminActorV1> {
    const { userId } = await seedUser({ role: "admin" });
    if (superAdmin)
      await db.update(npUsers).set({ isSuperAdmin: true }).where(eq(npUsers.id, userId));
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
  const actor = await staff(),
    approver = await staff(true),
    siteAdmin = await staff();
  const audience = options.audience ?? "staff";
  const principalId = options.ownSession
    ? actor.user.id
    : audience === "staff"
      ? (await seedUser({ email: "guardian-target@example.test" })).userId
      : (await seedActiveMember({ email: "guardian-target@example.test" })).memberId;
  const [session] =
    audience === "staff"
      ? await db
          .select({ id: npSessions.id, createdAt: npSessions.createdAt })
          .from(npSessions)
          .where(eq(npSessions.userId, principalId))
      : await db
          .select({ id: npMemberSessions.id, createdAt: npMemberSessions.createdAt })
          .from(npMemberSessions)
          .where(eq(npMemberSessions.memberId, principalId));
  const email = options.ownSession ? actor.user.email : "guardian-target@example.test";
  let time = new Date(session.createdAt.getTime() + 10),
    recent = true,
    approverVisible = true;
  const invisible = new Set<string>();
  const now = () => new Date(time);
  const never = () =>
    Promise.reject(new Error("Session response must not invoke Runtime/providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "guardian-session-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const sourceOptions = {
    actorKey: { id: "guardian-session-fixture", bytes: new Uint8Array(32).fill(31) },
    isInstalledSite: async () => true,
    authorize: async () => {},
    events,
    now,
  };
  const guardian = createAgentGuardianObservationServiceV1(sourceOptions);
  for (let i = 0; i < 5; i++)
    await guardian.observe({
      kind: "login-failed",
      siteId: "default",
      observationId: randomUUID(),
      occurredAt: new Date(session.createdAt.getTime() - 5000 + i).toISOString(),
      networkAddress: "192.0.2.71",
      loginIdentifier: email,
      audience,
    });
  const collector = createAgentGuardianSessionObservationServiceV1(sourceOptions);
  const observed = await collector.observe({
    siteId: "default",
    observationId: randomUUID(),
    occurredAt: now().toISOString(),
    networkAddress: "192.0.2.71",
    audience,
    principalId,
    sessionFamilyId: session.id,
  });
  if (!observed.incidentId) throw new Error("Expected actual trusted session Incident");
  const incidentId = observed.incidentId;
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(32),
    now,
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      if (invisible.has(context.actor.user.id)) return false;
      try {
        await npReadGuardianSessionIncidentEvidenceV1({ db, siteId: context.siteId, incident });
        return true;
      } catch {
        return false;
      }
    },
  }).staff;
  let policy: NpAgentGuardianSessionPolicyV1 | null = {
    policyDigest: `cj1:sha256:${"A".repeat(43)}`,
    approvalLifetimeSeconds: 600,
  };
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
  const service = createAgentGuardianSessionServiceV1({
    reads,
    events,
    resolveApprovals: () => approvals,
    resolvePolicy: async () => policy,
    canReviewIncidentAsStaffUser: ({ userId }) => approverVisible && !invisible.has(userId),
    admission: { reauthentication },
    now,
  });
  const targets = createAgentApprovalActionTargetRouterV1({
    owners: [
      { capabilityIds: ["security.revokeSessions"], resolve: () => service.approvalTargets },
    ],
  });
  approvals = createAgentApprovalServiceV1({
    targets,
    now,
    reauthentication,
    cursorKey: new Uint8Array(32).fill(33),
    integrityKeys: {
      active: {
        owner: "approval-integrity",
        id: "guardian-session-integrity",
        bytes: new Uint8Array(32).fill(34),
      },
    },
    challengeKeys: {
      active: { id: "guardian-session-challenge", key: new Uint8Array(32).fill(35) },
    },
    secretRequestDigestKey: { id: "guardian-session-secret", key: new Uint8Array(32).fill(36) },
  });
  const input = { siteId: "default", actor, incidentId };
  async function decide(
    approvalId: string,
    viewer = approver,
    decision: "approve" | "reject" | "revoke" = "approve",
  ) {
    const identity = { siteId: input.siteId, actor: viewer, id: approvalId },
      detail = await approvals.get(identity);
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
        reason: "Reviewed exact session family and deployment impact",
      },
    });
  }
  async function plan() {
    const current = await service.get(input),
      command = {
        schemaVersion: "np.agent-guardian-session-plan-input.v1" as const,
        expectedVersion: current.incidentVersion,
        expectedTargetVersionDigest: current.targetVersionDigest,
        idempotencyKey: randomUUID(),
      };
    const result = await service.plan({ ...input, command });
    const [approval] = await db
      .select()
      .from(npAgentApprovals)
      .where(eq(npAgentApprovals.targetActionId, result.resourceId));
    if (!approval) throw new Error("Expected session Action approval");
    const execute = {
      schemaVersion: "np.agent-guardian-session-execute-input.v1" as const,
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
    siteAdmin,
    principalId,
    audience,
    session,
    sourceEventId: observed.eventId!,
    input,
    reads,
    service,
    approvals,
    now,
    staff,
    plan,
    decide,
    setPolicy: (next: NpAgentGuardianSessionPolicyV1 | null) => {
      policy = next;
    },
    setRecent: (value: boolean) => {
      recent = value;
    },
    setApproverVisible: (value: boolean) => {
      approverVisible = value;
    },
    hideFrom: (userId: string) => invisible.add(userId),
    setTime: (date: Date) => {
      time = date;
    },
  };
}
