import type { NpAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { randomUUID } from "node:crypto";
import {
  createAgentApprovalServiceV1,
  type NpAgentApprovalServiceV1,
} from "../../../packages/core/src/agent/approval-service.js";
import { createAgentApprovalActionTargetRouterV1 } from "../../../packages/core/src/agent/approval-action-targets.js";
import {
  createAgentOperatorServiceV1,
  type NpAgentOperatorHostV1,
} from "../../../packages/core/src/agent/operator-service.js";
import {
  createAgentOperatorCapabilityFacadeV1,
  type NpAgentOperatorCapabilityFacadeV1,
} from "../../../packages/core/src/agent/operator-capability.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { NpAgentGatewayError } from "../../../packages/core/src/agent/admin-admission.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import {
  npRequireAgentOperatorCapabilityInvocationRequestV1,
  npRequireAgentOpsPlanOutputV1,
  type NpAgentExecutableOpsPlanInputV1,
} from "../../../packages/core/src/agent-contract/operator-capability-contract.js";
import { npResolveAgentBudgetV1 } from "../../../packages/core/src/agent-contract/runtime-budget.js";
import { fixture, principalFixture, siteId } from "./agent-changeset-fixture.js";
import { runtimeBudget } from "./agent-runtime-service-fixture.js";

export function operatorRequest(
  capabilityId: "ops.plan" | "ops.execute",
  input: unknown,
  idempotencyKey = randomUUID(),
) {
  return npRequireAgentOperatorCapabilityInvocationRequestV1({
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId,
    arguments: { input, idempotencyKey },
  });
}
export async function operatorExecutionFixture(
  override: Partial<NpAgentOperatorHostV1> = {},
  existingFoundation?: Pick<Awaited<ReturnType<typeof fixture>>, "db" | "actor">,
  runtimeAdmission?: NpAgentRuntimeAdmissionV1,
  sourceNow?: () => Date,
) {
  const f = existingFoundation ?? (await fixture());
  const initialTime = new Date();
  let clockOffset = 0;
  const currentTime = () => new Date((sourceNow?.() ?? initialTime).getTime() + clockOffset);
  const p = await principalFixture(
    f,
    false,
    { now: currentTime },
    ["ops:plan", "ops:execute"],
    "approved-execute",
  );
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "operator-execution", key: new Uint8Array(32).fill(81) },
      resolveBlockSchemas: () => [],
      resolveUser: () => f.actor.actor.user,
    }),
  );
  let facade: NpAgentOperatorCapabilityFacadeV1 | null = null;
  let approvals: NpAgentApprovalServiceV1 | null = null;
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission,
    resolveOperatorCapabilities: () => facade,
    resolveGatewaySettings: () => p.gatewaySettings,
    now: currentTime,
  });
  const state = {
    allowed: true,
    approvalAllowed: true,
    executions: 0,
    fail: false,
    hold: null as Promise<void> | null,
  };
  const host: NpAgentOperatorHostV1 = {
    assertAccess: async ({ siteId: current }) => {
      if (current !== siteId || !state.allowed)
        throw new NpAgentGatewayError("FORBIDDEN", 403, "Unavailable.");
    },
    assertApprovalAccess: async () => {
      if (!state.approvalAllowed) throw new NpAgentGatewayError("FORBIDDEN", 403, "Unavailable.");
    },
    plan: async ({ input }) => ({
      artifact: { operation: input, privatePath: "/private/fixture" },
      contractId: "fixture.operator.v1",
      projectCommand: "",
      checks: [{ id: "target.current-authority", status: "pass" }],
    }),
    execute: async () => {
      state.executions++;
      if (state.hold) await state.hold;
      if (state.fail) throw new Error("private adapter failure");
      return {
        state: "succeeded",
        evidence: { applied: true },
        verificationRefs: ["cache:fixture-applied"],
      };
    },
    ...override,
  };
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.capabilityModes = [
    { capabilityId: "ops.execute", mode: "approved" },
    { capabilityId: "ops.plan", mode: "approved" },
  ];
  rules.risk.requirePreviewAtOrAbove = null;
  const budget = npResolveAgentBudgetV1(runtimeBudget());
  const service = createAgentOperatorServiceV1({
    admission,
    runtimeAdmission,
    host,
    resolveApprovals: () => {
      if (!approvals) throw new Error("Approval owner unavailable");
      return approvals;
    },
    resolvePolicy: async () => ({
      autonomy: "approved",
      capabilityModes: rules.capabilityModes,
      layers: [rules],
    }),
    resolveBudget: async () => budget,
    resolveTransportAudience: p.gateway.getTransportAudience,
    now: currentTime,
  });
  facade = createAgentOperatorCapabilityFacadeV1(service);
  const targets = createAgentApprovalActionTargetRouterV1({
    owners: [{ capabilityIds: ["ops.execute"], resolve: () => service.approvalTargets }],
  });
  approvals = createAgentApprovalServiceV1({
    targets,
    resolveActionTargets: () => targets,
    cursorKey: new Uint8Array(32).fill(82),
    integrityKeys: {
      active: {
        owner: "approval-integrity",
        id: "operator-integrity",
        bytes: new Uint8Array(32).fill(83),
      },
    },
    challengeKeys: { active: { id: "operator-challenge", key: new Uint8Array(32).fill(84) } },
    secretRequestDigestKey: { id: "operator-request", key: new Uint8Array(32).fill(85) },
    reauthentication: {
      verify: () => ({
        reauthenticatedAt: currentTime().toISOString(),
        sessionFactFingerprint: `cj1:sha256:${"A".repeat(43)}`,
      }),
    },
    now: currentTime,
  });
  const invoke = (request: ReturnType<typeof operatorRequest>) =>
    admission.invoke({ authentication: p.authentication, request });
  async function plan(
    operation: NpAgentExecutableOpsPlanInputV1 = {
      action: "cache.revalidate",
      target: { kind: "site" },
    },
  ) {
    const result = await invoke(operatorRequest("ops.plan", operation));
    const output = npRequireAgentOpsPlanOutputV1(result.output);
    if (output.execution.kind !== "agent-executable") throw new Error("Expected real approval");
    const input = {
      planId: output.planId,
      planDigest: output.planDigest,
      approvalId: output.execution.approvalId,
      ...(operation.action === "cache.revalidate"
        ? { action: operation.action, target: operation.target }
        : operation.action === "agent.run.retry"
          ? { action: operation.action, failedRunId: operation.target.runId }
          : { action: operation.action, runId: operation.target.runId }),
    };
    return {
      output,
      request: operatorRequest("ops.execute", input),
      approvalId: output.execution.approvalId,
    };
  }
  async function decide(approvalId: string, decision: "approve" | "revoke" = "approve") {
    if (!approvals) throw new Error("Approval owner unavailable");
    const identity = { siteId, actor: f.actor.actor, id: approvalId };
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
        reason: "Reviewed exact Operator plan",
      },
    });
  }
  return {
    ...f,
    p,
    state,
    host,
    service,
    admission,
    approvals,
    rules,
    budget,
    invoke,
    plan,
    decide,
    advance: (seconds: number) => {
      clockOffset += seconds * 1000;
    },
  };
}
