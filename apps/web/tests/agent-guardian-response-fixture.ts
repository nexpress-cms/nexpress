import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { npRequireAuthUser } from "../../../packages/core/src/auth-contract/contract.js";
import { npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import {
  npAgentApprovals,
  npAgentActorRestrictions,
} from "../../../packages/core/src/db/schema/agent.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentGuardianObservationServiceV1,
  npReadAgentGuardianIncidentEvidenceV1,
} from "../../../packages/core/src/agent/guardian-observation-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import {
  createAgentGuardianResponseServiceV1,
  type NpAgentGuardianResponsePolicyV1,
} from "../../../packages/core/src/agent/guardian-response-service.js";
import { createAgentPostgresRestrictionAdapterV1 } from "../../../packages/core/src/agent/guardian-restriction-adapter.js";
import type { NpAgentRestrictionAdapter } from "../../../packages/core/src/agent-contract/restriction-adapter-contract.js";
import { createAgentApprovalServiceV1 } from "../../../packages/core/src/agent/approval-service.js";
import { createAgentApprovalActionTargetRouterV1 } from "../../../packages/core/src/agent/approval-action-targets.js";
import type { NpAgentAdminActorV1 } from "../../../packages/core/src/agent/admin-admission.js";
import type { NpAgentGuardianResponseOperationV1 } from "../../../packages/core/src/agent-contract/guardian-response-contract.js";
import { getTestDb, seedUser } from "./harness.js";

export async function guardianResponseFixture(
  wrapAdapter?: (adapter: NpAgentRestrictionAdapter) => NpAgentRestrictionAdapter,
) {
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
  let time = new Date();
  const now = () => new Date(time);
  const never = () => Promise.reject(new Error("Guardian must not invoke Runtime/providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "guardian-response-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const guardian = createAgentGuardianObservationServiceV1({
    actorKey: { id: "guardian-response-key", bytes: new Uint8Array(32).fill(91) },
    isInstalledSite: async () => true,
    authorize: async () => {},
    events,
    now,
  });
  let incidentId: string | null = null;
  for (let index = 0; index < 5; index++) {
    const observation = await guardian.observe({
      kind: "login-failed",
      siteId: "default",
      observationId: randomUUID(),
      occurredAt: now().toISOString(),
      networkAddress: "192.0.2.42",
      loginIdentifier: "private@example.test",
      audience: "staff",
    });
    incidentId = observation.incidentId ?? incidentId;
    time = new Date(time.getTime() + 1);
  }
  if (!incidentId) throw new Error("Expected actual Guardian Incident");
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(92),
    now,
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      try {
        await npReadAgentGuardianIncidentEvidenceV1({ db, siteId: context.siteId, incident });
        return true;
      } catch {
        return false;
      }
    },
  }).staff;
  const postgres = createAgentPostgresRestrictionAdapterV1({ db: () => db, now });
  const adapter = wrapAdapter?.(postgres) ?? postgres;
  let currentPolicy: NpAgentGuardianResponsePolicyV1 | null = {
    policyDigest: `cj1:sha256:${"A".repeat(43)}`,
    maximumDurationSeconds: 3600,
    approvalLifetimeSeconds: 600,
    allowedScopes: ["auth.staff"],
  };
  let revokeAfterStage = false;
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
  const service = createAgentGuardianResponseServiceV1({
    reads,
    adapter,
    canEnforceSubject: async () => true,
    resolveApprovals: () => approvals,
    resolvePolicy: async () =>
      revokeAfterStage &&
      (await db.select({ id: npAgentActorRestrictions.id }).from(npAgentActorRestrictions).limit(1))
        .length
        ? null
        : currentPolicy,
    canReviewIncidentAsStaffUser: () => approverVisible,
    admission: { reauthentication },
    now,
  });
  const targetRouter = createAgentApprovalActionTargetRouterV1({
    owners: [
      {
        capabilityIds: ["security.limitActor", "security.removeActorLimit"],
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
        id: "guardian-response-test-integrity",
        bytes: new Uint8Array(32).fill(94),
      },
    },
    challengeKeys: {
      active: { id: "guardian-response-test-challenge", key: new Uint8Array(32).fill(95) },
    },
    secretRequestDigestKey: {
      id: "guardian-response-test-secret",
      key: new Uint8Array(32).fill(96),
    },
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
    operation: NpAgentGuardianResponseOperationV1 = {
      kind: "limit",
      durationSeconds: 600,
      actionScopes: ["auth.staff"],
    },
    requester = actor,
  ) {
    const current = await service.get({ ...input, actor: requester });
    const command = {
      schemaVersion: "np.agent-guardian-response-plan-input.v1" as const,
      expectedVersion: current.incidentVersion,
      expectedTargetVersionDigest: current.targetVersionDigest,
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
      schemaVersion: "np.agent-guardian-response-execute-input.v1" as const,
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
    adapter,
    guardian,
    reads,
    service,
    approvals,
    input,
    now,
    plan,
    decide,
    setTime: (value: Date) => {
      time = value;
    },
    setPolicy: (value: NpAgentGuardianResponsePolicyV1 | null) => {
      currentPolicy = value;
    },
    revokeAfterStage: () => {
      revokeAfterStage = true;
    },
    setRecent: (value: boolean) => {
      recent = value;
    },
    setApproverVisible: (value: boolean) => {
      approverVisible = value;
    },
  };
}
