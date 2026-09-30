import type { NpAgentJsonObject } from "../agent-contract/types.js";
import type {
  NpAgentAuditRunInputV1,
  NpAgentAuditRunOutputV1,
  NpAgentOpsPlanInputV1,
  NpAgentExecutableOpsPlanInputV1,
  NpAgentOpsExecuteInputV1,
  NpAgentOpsPlanOutputV1,
} from "../agent-contract/operator-capability-contract.js";
import type { NpAgentRuntimeApprovalInspectionV1 } from "./changeset-service.js";
import type { NpAuthUser } from "../config/types.js";
import type { getDb } from "../db/runtime.js";
import type { NpAgentReadCapabilityContextV1 } from "./capability-registry.js";

/** Current admitted caller and transaction. No ambient context crosses jobs. */
export interface NpAgentOperatorHostContextV1 extends NpAgentReadCapabilityContextV1 {
  db: ReturnType<typeof getDb>;
}
export interface NpAgentOperatorPlanArtifactV1 {
  artifact: NpAgentJsonObject;
  contractId: string;
  projectCommand: string;
  checks: NpAgentOpsPlanOutputV1["checks"];
}
export interface NpAgentOperatorExecutionResultV1 {
  state: "succeeded" | "failed" | "conflicted";
  evidence: NpAgentJsonObject;
  verificationRefs: string[];
}
/** Explicit installation only. Audit and plan adapters read actual owners without effects.
 * Execution runs only after an exact approval and a committed dispatch reservation.
 * Adapters honor abortSignal; private execution evidence never enters the public wire. */
export interface NpAgentOperatorHostV1 {
  assertAccess(
    input: NpAgentOperatorHostContextV1 & {
      capabilityId: "audit.run" | "ops.plan" | "ops.execute";
      input: NpAgentAuditRunInputV1 | NpAgentOpsPlanInputV1 | NpAgentOpsExecuteInputV1;
    },
  ): Promise<void>;
  audit?(
    input: NpAgentOperatorHostContextV1 & {
      input: NpAgentAuditRunInputV1;
      auditId: string;
    },
  ): Promise<{ checks: NpAgentAuditRunOutputV1["checks"] }>;
  assertApprovalAccess?(input: {
    db: ReturnType<typeof getDb>;
    siteId: string;
    staffUser: NpAuthUser;
    input: NpAgentExecutableOpsPlanInputV1;
    artifact: NpAgentJsonObject;
    contractId: string;
  }): Promise<void>;
  execute?(
    input: NpAgentOperatorHostContextV1 & {
      input: NpAgentExecutableOpsPlanInputV1;
      artifact: NpAgentJsonObject;
      contractId: string;
      executionId: string;
    },
  ): Promise<NpAgentOperatorExecutionResultV1>;
  plan?(
    input: NpAgentOperatorHostContextV1 & {
      input: NpAgentOpsPlanInputV1;
      planId: string;
    },
  ): Promise<NpAgentOperatorPlanArtifactV1>;
}

import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb as database } from "../db/runtime.js";
import {
  npAgentApprovals,
  npAgentOperatorExecutions,
  npAgentActions,
  npAgentInvocations,
  npAgentMcpTasks,
  npAgentOperatorPlans,
} from "../db/schema/agent.js";
import { npUsers, npSiteMemberships } from "../db/schema/system.js";
import type {
  NpAgentApprovalServiceV1,
  NpAgentApprovalServiceOptionsV1,
} from "./approval-service.js";
import {
  npResolveAgentPolicyV1,
  npAgentAutonomyAllowsV1,
  type NpAgentPolicyResolutionInputV1,
} from "../agent-contract/runtime-policy.js";
import {
  npResolveAgentBudgetV1,
  type NpAgentConcreteBudgetV1,
} from "../agent-contract/runtime-budget.js";
import { npMeasureAgentDirectActionBudgetV1 } from "./moderation-run.js";
import { npFailAgentRuntimeApprovalInTransactionV1 } from "./runtime-execution-store.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npRequireAgentApprovalStatementCanonical } from "../agent-contract/canonical-approval.js";
import type {
  NpAgentApprovalStatementCanonicalV1,
  NpAgentApprovalTargetV1,
} from "../agent-contract/types.js";
import {
  npResolveLiveAgentStaffAuthorizationV1,
  npResolveAgentStaffSessionAuthorizationV1,
  type NpAgentAdminActorV1,
} from "./admin-admission.js";
import { npAuditEvents } from "../db/schema/community.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentInvocationRequestCanonical,
  npDigestAgentInvocationRequestCanonical,
} from "../agent-contract/canonical-idempotency-request.js";
import {
  npRequireAgentActionCanonical,
  npDigestAgentActionCanonical,
} from "../agent-contract/canonical-action.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npRequireAgentOperatorCapabilityInvocationRequestV1,
  npBuildAgentOperatorCapabilityDefinitionCanonicalV1,
  npRequireAgentOperatorCapabilityInputV1,
  npRequireAgentOperatorCapabilityOutputV1,
  type NpAgentOperatorCapabilityIdV1,
  type NpAgentOperatorCapabilityInvocationRequestV1,
  type NpAgentOperatorCapabilityInvocationResultV1,
} from "../agent-contract/operator-capability-contract.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";
import type { NpAgentResolvedCapabilityPrincipalV1 } from "./capability-registry.js";
import {
  npRuntimeAuthorizationContextV1,
  type NpAgentRuntimeAdmissionV1,
  type NpAgentRuntimeRunContextV1,
  type NpAgentRuntimeExecutionClaimV1,
} from "./runtime-admission.js";
import type { NpAgentGatewayServiceV1 } from "./gateway-service.js";
import type { NpAgentMcpTaskRequestV1, NpAgentMcpTaskServiceV1 } from "./mcp-task-service.js";
import type {
  NpAgentAuthorizationContextCanonicalV1,
  NpAgentScope,
} from "../agent-contract/types.js";
import {
  npAgentMcpTaskLimitsV1,
  type NpAgentMcpTaskV1,
} from "../agent-contract/mcp-task-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { withDeferredPostCommit, runPostCommit } from "../collections/pipeline.js";
import { withCurrentSite } from "../sites/context.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { registerJobHandler } from "../jobs/handlers.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

type Db = ReturnType<typeof database>;
type Invocation = typeof npAgentInvocations.$inferSelect;
type CommandInput = NpAgentAuditRunInputV1 | NpAgentOpsPlanInputV1 | NpAgentOpsExecuteInputV1;
const json = (value: object): NpAgentJsonObject => value as unknown as NpAgentJsonObject;
const digest = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(domain + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
const unavailable = () =>
  new NpAgentGatewayError("CAPABILITY_UNAVAILABLE", 404, "Operator capability is unavailable.");
const conflict = () =>
  new NpAgentGatewayError("CONFLICT", 409, "Operator evidence changed or is unavailable.");
export interface NpAgentOperatorAuditJobV1 {
  siteId: string;
  invocationId: string;
}
export interface NpAgentOperatorServiceOptionsV1 {
  admission: NpAgentCapabilityAdmissionServiceV1;
  host: NpAgentOperatorHostV1;
  resolveApprovals?: () => NpAgentApprovalServiceV1;
  resolveBudget?: (input: { db: Db; siteId: string }) => Promise<NpAgentConcreteBudgetV1>;
  resolvePolicy?: (
    input: NpAgentOperatorHostContextV1 & {
      input: NpAgentExecutableOpsPlanInputV1;
    },
  ) => Promise<NpAgentPolicyResolutionInputV1>;
  resolveTransportAudience: NpAgentGatewayServiceV1["getTransportAudience"];
  /** Explicit producer. No worker or queue is installed by constructing the service. */
  enqueueAudit?: (input: NpAgentOperatorAuditJobV1) => Promise<string>;
  runtimeAdmission?: NpAgentRuntimeAdmissionV1;
  tasks?: NpAgentMcpTaskServiceV1;
  now?: () => Date;
}
interface ActorContext {
  db: Db;
  time: Date;
  principal: NpAgentResolvedCapabilityPrincipalV1;
  authorizationContext: NpAgentAuthorizationContextCanonicalV1;
  authorizationContextFingerprint: string;
  authentication?: NpAgentCapabilityAuthenticationV1;
  runtime?: NpAgentRuntimeRunContextV1;
  sequence: number;
}
export function createAgentOperatorServiceV1(options: NpAgentOperatorServiceOptionsV1) {
  const now = options.now ?? (() => new Date());
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new NpAgentGatewayError("CAPABILITY_TIMEOUT", 504, "Operator check timed out."),
              ),
            30_000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const capabilityIds: NpAgentOperatorCapabilityIdV1[] = [];
  if (options.host.audit && options.enqueueAudit) capabilityIds.push("audit.run");
  if (options.host.plan) capabilityIds.push("ops.plan");
  if (
    options.host.execute &&
    options.host.assertApprovalAccess &&
    options.resolvePolicy &&
    options.resolveApprovals
  )
    capabilityIds.push("ops.execute");
  capabilityIds.sort();
  function context(actor: ActorContext, invocationId: string): NpAgentOperatorHostContextV1 {
    return {
      db: actor.db,
      transaction: actor.db,
      siteId: actor.principal.siteId,
      principal: actor.principal,
      requestedAt: actor.time.toISOString(),
      invocationId,
      idempotencyKey: null,
      abortSignal: AbortSignal.timeout(30_000),
      ...(actor.runtime
        ? {
            staffUser: actor.runtime.staffUser,
            runtimeResources: actor.runtime.policy.effective.resources,
          }
        : {}),
    };
  }
  function principal(
    authentication: NpAgentCapabilityAuthenticationV1,
  ): NpAgentResolvedCapabilityPrincipalV1 {
    const auth = authentication.principal.authority;
    const authority =
      auth.kind === "user" && auth.userId
        ? { kind: "user" as const, userId: auth.userId }
        : auth.kind === "deployment" && auth.policyId
          ? { kind: "deployment" as const, policyId: auth.policyId }
          : null;
    if (!authority) throw unavailable();
    const oauth = "kind" in authentication && authentication.kind === "oauth";
    const ceiling = authentication.authorizationContext.gatewayExposure;
    if (!ceiling) throw unavailable();
    return {
      kind: oauth ? "oauth-user" : "service",
      principalId: authentication.principal.id,
      siteId: authentication.principal.siteId,
      authority,
      credentialId:
        "serviceToken" in authentication ? authentication.serviceToken.id : authentication.grantId,
      gatewayExposureCeiling: ceiling,
      scopes: authentication.scopes,
    };
  }
  async function runtimeActor(
    runtime: NpAgentRuntimeRunContextV1,
    sequence: number,
  ): Promise<ActorContext> {
    const p = runtime.evidence.principal;
    const authority =
      p.authorityKind === "user" && p.authorityUserId
        ? { kind: "user" as const, userId: p.authorityUserId }
        : p.authorityPolicyId
          ? { kind: "deployment" as const, policyId: p.authorityPolicyId }
          : null;
    if (!authority || !Number.isSafeInteger(sequence) || sequence < 1) throw unavailable();
    return {
      db: runtime.db,
      time: runtime.now,
      runtime,
      sequence,
      principal: {
        kind: "runtime",
        siteId: runtime.siteId,
        principalId: p.id,
        runId: runtime.run.id,
        scopes: runtime.evidence.definition.scopes,
        authority,
      },
      ...(await npRuntimeAuthorizationContextV1(runtime)),
    };
  }
  async function definition(id: NpAgentOperatorCapabilityIdV1) {
    const canonical = npBuildAgentOperatorCapabilityDefinitionCanonicalV1(id);
    const fingerprint = await npDigestAgentCapabilityRegistryCanonical(
      canonical,
      canonical.capabilities,
    );
    return { canonical, fingerprint, descriptor: canonical.capabilities[0].descriptor };
  }
  function requireEnabled(id: NpAgentOperatorCapabilityIdV1, input: CommandInput) {
    if (!capabilityIds.includes(id)) throw unavailable();
    if (
      id === "ops.plan" &&
      "action" in input &&
      ["cache.revalidate", "agent.run.retry", "agent.run.cancel"].includes(input.action) &&
      !capabilityIds.includes("ops.execute")
    )
      throw unavailable();
  }
  async function access(
    actor: ActorContext,
    id: NpAgentOperatorCapabilityIdV1,
    input: CommandInput,
    invocationId: string,
  ) {
    requireEnabled(id, input);
    const entry = await definition(id);
    if (entry.descriptor.requiredScopes.some((scope) => !actor.principal.scopes.includes(scope)))
      throw unavailable();
    if (
      actor.runtime &&
      !(await options.admission.sourceEntries(actor.runtime)).some(
        (e) => e.canonical.descriptor.id === id,
      )
    )
      throw unavailable();
    if (id === "ops.execute" && "planId" in input) {
      const [plan] = await actor.db
        .select()
        .from(npAgentOperatorPlans)
        .where(
          and(
            eq(npAgentOperatorPlans.siteId, actor.principal.siteId),
            eq(npAgentOperatorPlans.id, input.planId),
          ),
        )
        .limit(1);
      if (
        !plan ||
        plan.artifactDigest !== input.planDigest ||
        digest("np.agent-operator-plan-artifact.v1", {
          operation: plan.operation,
          contractId: plan.contractId,
          artifact: plan.artifactCanonical,
        }) !== input.planDigest
      )
        throw conflict();
      const operation =
        input.action === "cache.revalidate"
          ? { action: input.action, target: input.target }
          : {
              action: input.action,
              target: {
                kind: "run",
                runId: input.action === "agent.run.retry" ? input.failedRunId : input.runId,
              },
            };
      if (!same(operation, plan.operation)) throw conflict();
      input = npRequireAgentOperatorCapabilityInputV1("ops.plan", plan.operation);
    }
    await options.host.assertAccess({ ...context(actor, invocationId), capabilityId: id, input });
  }
  async function verifyPlan(actor: ActorContext, row: Invocation, output: NpAgentOpsPlanOutputV1) {
    const [plan] = await actor.db
      .select()
      .from(npAgentOperatorPlans)
      .where(
        and(
          eq(npAgentOperatorPlans.siteId, row.siteId),
          eq(npAgentOperatorPlans.invocationId, row.id),
        ),
      )
      .limit(1);
    if (
      !plan ||
      plan.id !== output.planId ||
      plan.auditEventId !== row.auditEventId ||
      plan.expiresAt <= actor.time ||
      plan.expiresAt.toISOString() !== output.expiresAt ||
      digest("np.agent-operator-plan-artifact.v1", {
        operation: plan.operation,
        contractId: plan.contractId,
        artifact: plan.artifactCanonical,
      }) !== plan.artifactDigest ||
      plan.artifactDigest !== output.planDigest ||
      (output.execution.kind === "local-cli-handoff" &&
        (output.execution.planArtifactId !== plan.id ||
          output.execution.contractId !== plan.contractId)) ||
      (output.execution.kind === "agent-executable" && !plan.approvalActionId) ||
      serializeAgentCanonicalJson(plan.operation) !== serializeAgentCanonicalJson(output.operation)
    )
      throw conflict();
    if (output.execution.kind === "agent-executable") {
      const [action] = await actor.db
        .select()
        .from(npAgentActions)
        .where(
          and(eq(npAgentActions.siteId, row.siteId), eq(npAgentActions.id, plan.approvalActionId!)),
        )
        .limit(1);
      if (
        !action ||
        action.approvalId !== output.execution.approvalId ||
        action.invocationId !== row.id ||
        action.capabilityId !== "ops.execute"
      )
        throw conflict();
    }
  }
  async function replay(
    actor: ActorContext,
    row: Invocation,
    id: NpAgentOperatorCapabilityIdV1,
    parsed: CommandInput,
    hash: string,
  ) {
    if (
      row.requestHash !== hash ||
      row.expiresAt <= actor.time ||
      !["accepted", "completed"].includes(row.state) ||
      !row.outputRedacted ||
      digest("np.agent-capability-output.v1", row.outputRedacted) !== row.outputHash
    )
      throw conflict();
    if (
      (await npDigestAgentInvocationRequestCanonical(
        npRequireAgentInvocationRequestCanonical(row.requestBody),
      )) !== row.requestHash
    )
      throw conflict();
    await access(actor, id, parsed, row.id);
    const currentDefinition = await definition(id);
    if (
      row.contractFingerprint !== currentDefinition.fingerprint ||
      serializeAgentCanonicalJson(row.capabilityDefinitionBody) !==
        serializeAgentCanonicalJson(currentDefinition.canonical) ||
      row.operationId !== id ||
      row.principalId !== actor.principal.principalId
    )
      throw conflict();
    const output = npRequireAgentOperatorCapabilityOutputV1(id, row.outputRedacted);
    const [audit] = await actor.db
      .select()
      .from(npAuditEvents)
      .where(and(eq(npAuditEvents.siteId, row.siteId), eq(npAuditEvents.id, row.auditEventId)))
      .limit(1);
    if (
      !audit ||
      audit.payload?.invocationId !== row.id ||
      audit.payload.requestHash !== row.requestHash ||
      audit.payload.schemaVersion !== "np.agent-operator-audit.v1" ||
      audit.payload.capabilityId !== id ||
      (row.state === "completed" &&
        (audit.payload.outcome !== "completed" || audit.payload.outputDigest !== row.outputHash))
    )
      throw conflict();
    if (id === "audit.run") {
      const evidence = output as NpAgentAuditRunOutputV1;
      if (
        evidence.auditId !== row.auditEventId ||
        (evidence.state === "completed") !== (row.state === "completed") ||
        (evidence.state === "completed" &&
          (evidence.digest !==
            digest("np.agent-operator-audit-evidence.v1", {
              siteId: row.siteId,
              auditId: row.auditEventId,
              input: parsed,
              checks: evidence.checks,
            }) ||
            audit.payload.outputDigest !== row.outputHash))
      )
        throw conflict();
    }
    if (id === "ops.plan") await verifyPlan(actor, row, output as NpAgentOpsPlanOutputV1);
    return {
      schemaVersion: "np.agent-operator-invocation-result.v1" as const,
      invocationId: row.id,
      capabilityId: id,
      output,
    };
  }
  async function complete(
    actor: ActorContext,
    row: Invocation,
    output: NpAgentAuditRunOutputV1 | NpAgentOpsPlanOutputV1,
  ) {
    const outputRedacted = json(output),
      outputHash = digest("np.agent-capability-output.v1", output);
    await actor.db
      .update(npAgentInvocations)
      .set({ state: "completed", outputRedacted, outputHash, completedAt: actor.time })
      .where(and(eq(npAgentInvocations.siteId, row.siteId), eq(npAgentInvocations.id, row.id)));
    await actor.db
      .update(npAgentActions)
      .set({ state: "succeeded", outputRedacted, outputHash, finishedAt: actor.time })
      .where(
        and(
          eq(npAgentActions.siteId, row.siteId),
          eq(npAgentActions.invocationId, row.id),
          eq(npAgentActions.capabilityId, row.operationId),
        ),
      );
    await actor.db
      .update(npAuditEvents)
      .set({
        payload: {
          schemaVersion: "np.agent-operator-audit.v1",
          capabilityId: row.operationId,
          invocationId: row.id,
          requestHash: row.requestHash,
          outcome: "completed",
          outputDigest: outputHash,
        },
      })
      .where(and(eq(npAuditEvents.siteId, row.siteId), eq(npAuditEvents.id, row.auditEventId)));
  }
  const same = (a: unknown, b: unknown) =>
    serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
  const executable = (input: NpAgentOpsPlanInputV1): input is NpAgentExecutableOpsPlanInputV1 =>
    ["cache.revalidate", "agent.run.retry", "agent.run.cancel"].includes(input.action);
  async function executionPolicy(
    actor: ActorContext,
    input: NpAgentExecutableOpsPlanInputV1,
    invocationId: string,
    phase: "request-approval" | "execute-approved",
  ) {
    if (!options.resolvePolicy) throw unavailable();
    const resolved = npResolveAgentPolicyV1(
      await options.resolvePolicy({ ...context(actor, invocationId), input }),
    );
    const mode = resolved.capabilityModes.find((item) => item.capabilityId === "ops.execute")?.mode;
    if (
      !mode ||
      !npAgentAutonomyAllowsV1(mode, phase) ||
      (resolved.risk.requirePreviewAtOrAbove !== null &&
        resolved.risk.requirePreviewAtOrAbove !== "destructive") ||
      (input.action === "cache.revalidate" &&
        "collection" in input.target &&
        resolved.resources.collections !== null &&
        !resolved.resources.collections.includes(input.target.collection))
    )
      throw unavailable();
    return [
      digest("np.agent-operator-execution-policy.v1", {
        resolved,
        budget: await executionBudget(actor),
      }),
    ];
  }
  async function executionBudget(actor: ActorContext) {
    const source =
      actor.runtime?.agentBudget ??
      (await options.resolveBudget?.({ db: actor.db, siteId: actor.principal.siteId }));
    if (!source) throw unavailable();
    return npResolveAgentBudgetV1(source);
  }
  async function executionStatement(
    actor: ActorContext,
    row: Invocation,
    planId: string,
    planDigest: string,
    input: NpAgentExecutableOpsPlanInputV1,
    expiresAt: Date,
  ) {
    if (!options.resolveApprovals || !capabilityIds.includes("ops.execute")) throw unavailable();
    const entry = await definition("ops.execute"),
      actionId = randomUUID(),
      approvalId = randomUUID();
    if (!actor.principal.scopes.includes("ops:execute")) throw unavailable();
    await npMeasureAgentDirectActionBudgetV1({
      db: actor.db,
      siteId: row.siteId,
      now: actor.time,
      target: { kind: "ops", action: input.action },
      budget: await executionBudget(actor),
      reserveRun: false,
    });
    const proposal = { planId, planDigest, operation: input };
    const canonical = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId: row.siteId,
      actionId,
      invocationFingerprint: row.requestHash,
      runFingerprint: null,
      sequence: actor.sequence + 1,
      capabilityId: "ops.execute",
      capabilityContractVersion: 1,
      capabilityFingerprint: entry.fingerprint,
      effectProfile: { id: "ops.execute", contractVersion: 1 },
      risk: "sensitive",
      requiredScopes: entry.descriptor.requiredScopes,
      targetRefs: [{ kind: "ops", action: input.action }],
      targetVersionFacts: [
        { targetRef: { kind: "ops", action: input.action }, versionDigest: planDigest },
      ],
      input: json(proposal),
    });
    const proposalHash = await npDigestAgentActionCanonical(canonical);
    const statement = npRequireAgentApprovalStatementCanonical({
      version: "np.agent-approval-statement.v1",
      siteId: row.siteId,
      approvalId,
      requester: {
        kind: "principal",
        principalId: row.principalId,
        fingerprint: row.actorFingerprint,
      },
      target: { kind: "action", actionId, runId: null, agentId: null, proposalHash },
      capabilityId: "ops.execute",
      capabilityContractVersion: 1,
      capabilityFingerprint: entry.fingerprint,
      requiredScopes: entry.descriptor.requiredScopes,
      requiredHumanCapabilities: ["admin.manage"],
      requiredHumanPredicates: [],
      policyHashes: await executionPolicy(actor, input, row.id, "request-approval"),
      requiresLivePreview: false,
      previewId: null,
      previewDigest: null,
      risk: "sensitive",
      reauthentication: { mode: "recent", maxAgeSeconds: 300, assurance: "staff-primary" },
      createdAt: actor.time.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    await actor.db.insert(npAgentActions).values({
      id: actionId,
      siteId: row.siteId,
      runId: null,
      runFingerprint: null,
      invocationId: row.id,
      invocationFingerprint: row.requestHash,
      sequence: actor.sequence + 1,
      capabilityId: "ops.execute",
      capabilityContractVersion: 1,
      capabilityFingerprint: entry.fingerprint,
      capabilityDefinitionBody: entry.canonical,
      effectProfileId: "ops.execute",
      effectContractVersion: 1,
      risk: "sensitive",
      state: "approval_pending",
      idempotencyKey: row.idempotencyKey,
      inputRedacted: json(proposal),
      inputCanonical: json(proposal),
      requiredScopes: canonical.requiredScopes,
      targetRefs: canonical.targetRefs,
      targetVersionFacts: canonical.targetVersionFacts,
      inputHash: proposalHash,
      approvalId,
      auditEventId: row.auditEventId,
      createdAt: actor.time,
    });
    await options.resolveApprovals().create({ db: actor.db, statement, generation: 1 });
    return { actionId, approvalId };
  }
  async function planEvidence(db: Db, siteId: string, planId: string, time: Date) {
    const [plan] = await db
      .select()
      .from(npAgentOperatorPlans)
      .where(and(eq(npAgentOperatorPlans.siteId, siteId), eq(npAgentOperatorPlans.id, planId)))
      .limit(1);
    if (
      !plan ||
      !plan.approvalActionId ||
      plan.expiresAt <= time ||
      digest("np.agent-operator-plan-artifact.v1", {
        operation: plan.operation,
        contractId: plan.contractId,
        artifact: plan.artifactCanonical,
      }) !== plan.artifactDigest
    )
      throw conflict();
    const input = npRequireAgentOperatorCapabilityInputV1("ops.plan", plan.operation);
    if (!executable(input)) throw conflict();
    const [action] = await db
      .select()
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, plan.approvalActionId)))
      .for("update")
      .limit(1);
    const [original] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, plan.invocationId)),
      )
      .limit(1);
    if (
      !action ||
      !original ||
      action.capabilityId !== "ops.execute" ||
      action.invocationId !== original.id ||
      action.runId !== null ||
      action.runFingerprint !== null ||
      action.invocationFingerprint !== original.requestHash ||
      !same(action.inputCanonical, {
        planId: plan.id,
        planDigest: plan.artifactDigest,
        operation: input,
      })
    )
      throw conflict();
    const canonical = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId,
      actionId: action.id,
      invocationFingerprint: action.invocationFingerprint,
      runFingerprint: null,
      sequence: action.sequence,
      capabilityId: action.capabilityId,
      capabilityContractVersion: action.capabilityContractVersion,
      capabilityFingerprint: action.capabilityFingerprint,
      effectProfile: { id: action.effectProfileId, contractVersion: action.effectContractVersion },
      risk: action.risk,
      requiredScopes: action.requiredScopes,
      targetRefs: action.targetRefs,
      targetVersionFacts: action.targetVersionFacts,
      input: action.inputCanonical,
    });
    const entry = await definition("ops.execute");
    if (
      (await npDigestAgentActionCanonical(canonical)) !== action.inputHash ||
      action.capabilityFingerprint !== entry.fingerprint ||
      !same(action.capabilityDefinitionBody, entry.canonical) ||
      (await npDigestAgentInvocationRequestCanonical(
        npRequireAgentInvocationRequestCanonical(original.requestBody),
      )) !== original.requestHash
    )
      throw conflict();
    return { plan, input, action, original };
  }
  async function liveApprover(
    db: Db,
    facts: Awaited<ReturnType<typeof planEvidence>>,
    userId: string,
  ) {
    await db.select({ id: npUsers.id }).from(npUsers).where(eq(npUsers.id, userId)).for("update");
    await db
      .select({ role: npSiteMemberships.role })
      .from(npSiteMemberships)
      .where(
        and(eq(npSiteMemberships.siteId, facts.plan.siteId), eq(npSiteMemberships.userId, userId)),
      )
      .for("update");
    const authority = await npResolveLiveAgentStaffAuthorizationV1(db, facts.plan.siteId, userId);
    if (
      !authority.authority.capabilities.includes("site.access") ||
      !authority.authority.capabilities.includes("admin.manage")
    )
      throw unavailable();
    const [user] = await db.select().from(npUsers).where(eq(npUsers.id, userId)).limit(1);
    if (!user || !options.host.assertApprovalAccess) throw unavailable();
    const staffUser: NpAuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role:
        authority.authority.kind === "super-admin"
          ? "admin"
          : (authority.authority.role as NpAuthUser["role"]),
      tokenVersion: user.tokenVersion,
    };
    await options.host.assertApprovalAccess({
      db,
      siteId: facts.plan.siteId,
      staffUser,
      input: facts.input,
      artifact: facts.plan.artifactCanonical,
      contractId: facts.plan.contractId,
    });
  }
  async function assertStatement(
    actor: ActorContext,
    facts: Awaited<ReturnType<typeof planEvidence>>,
    statement: NpAgentApprovalStatementCanonicalV1,
    phase: "request-approval" | "execute-approved",
  ) {
    if (
      statement.target.kind !== "action" ||
      statement.target.actionId !== facts.action.id ||
      statement.target.runId !== null ||
      statement.target.proposalHash !== facts.action.inputHash ||
      statement.approvalId !== facts.action.approvalId ||
      statement.capabilityId !== "ops.execute" ||
      statement.capabilityFingerprint !== facts.action.capabilityFingerprint ||
      statement.requester.kind !== "principal" ||
      statement.requester.principalId !== facts.original.principalId ||
      statement.requester.fingerprint !== facts.original.actorFingerprint ||
      !same(statement.requiredScopes, facts.action.requiredScopes) ||
      !same(
        statement.policyHashes,
        await executionPolicy(actor, facts.input, facts.original.id, phase),
      )
    )
      throw conflict();
    await replay(actor, facts.original, "ops.plan", facts.input, facts.original.requestHash);
  }
  async function withOriginal<T>(
    row: Invocation,
    mutate: (actor: ActorContext) => Promise<T>,
    allowTerminal = false,
  ): Promise<T> {
    return withCurrentSite(row.siteId, async () => {
      if (row.transport === "runtime") {
        if (!row.runId || !options.runtimeAdmission) throw unavailable();
        return options.runtimeAdmission.withRunAuthority(
          { siteId: row.siteId, runId: row.runId, allowTerminal },
          async (runtime) => mutate(await runtimeActor(runtime, 1)),
        );
      }
      return options.admission.withStoredAuthority({
        authorizationContext: row.authorizationContextBody,
        authorizationContextFingerprint: row.authorizationContextFingerprint,
        requiredScopes: row.operationId === "ops.execute" ? ["ops:execute"] : ["ops:plan"],
        minimumExposure: row.operationId === "ops.execute" ? "approved-execute" : "propose",
        resolveTransportAudience: options.resolveTransportAudience,
        prepareTransaction: (db) =>
          npWithAgentRuntimeControlTransactionV1(row.siteId, () => Promise.resolve(undefined), db),
        mutate: (db, time, authentication) =>
          mutate({
            db,
            time,
            authentication,
            sequence: 1,
            principal: principal(authentication),
            authorizationContext: authentication.authorizationContext,
            authorizationContextFingerprint: authentication.authorizationContextFingerprint,
          }),
      });
    });
  }
  async function withApprovalTarget<T>(
    siteId: string,
    target: NpAgentApprovalTargetV1,
    admin: NpAgentAdminActorV1 | undefined,
    mutate: (actor: ActorContext, facts: Awaited<ReturnType<typeof planEvidence>>) => Promise<T>,
    allowTerminal = false,
  ) {
    if (target.kind !== "action") throw unavailable();
    const [plan] = await database()
      .select()
      .from(npAgentOperatorPlans)
      .where(
        and(
          eq(npAgentOperatorPlans.siteId, siteId),
          eq(npAgentOperatorPlans.approvalActionId, target.actionId),
        ),
      )
      .limit(1);
    if (!plan) throw unavailable();
    const [original] = await database()
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, plan.invocationId)),
      )
      .limit(1);
    if (!original) throw unavailable();
    return withOriginal(
      original,
      async (actor) => {
        const facts = await planEvidence(actor.db, siteId, plan.id, actor.time);
        if (target.proposalHash !== facts.action.inputHash || target.runId !== null)
          throw conflict();
        if (admin) {
          await npResolveAgentStaffSessionAuthorizationV1(actor.db, siteId, admin, actor.time);
          await liveApprover(actor.db, facts, admin.user.id);
        }
        await replay(actor, original, "ops.plan", facts.input, original.requestHash);
        return mutate(actor, facts);
      },
      allowTerminal,
    );
  }
  async function failRuntimePlan(db: Db, original: Invocation, code: string, time: Date) {
    if (!original.runId) return;
    await db
      .update(npAgentActions)
      .set({ state: "failed", errorCode: code, finishedAt: time })
      .where(
        and(
          eq(npAgentActions.siteId, original.siteId),
          eq(npAgentActions.id, original.resultId!),
          sql`${npAgentActions.state} in ('approval_pending','approved')`,
        ),
      );
    await npFailAgentRuntimeApprovalInTransactionV1({
      db,
      siteId: original.siteId,
      runId: original.runId,
      now: time,
      errorCode: code,
    });
  }
  const approvalTargets: NpAgentApprovalServiceOptionsV1["targets"] = {
    visible: ({ siteId, target, actor }) =>
      withApprovalTarget(
        siteId,
        target,
        actor,
        () =>
          Promise.resolve({
            operationCount: 1,
            targetCount: 1,
            previewState: null,
            checksRun: null,
            rollbackPlan: "unavailable",
          }),
        true,
      ),
    actionReview: ({ siteId, target, actor }) =>
      withApprovalTarget(
        siteId,
        target,
        actor,
        (_ctx, facts) => {
          const output = npRequireAgentOperatorCapabilityOutputV1(
            "ops.plan",
            facts.original.outputRedacted,
          );
          return Promise.resolve({
            capabilityId: "ops.execute",
            actionId: facts.action.id,
            proposalHash: facts.action.inputHash,
            planId: facts.plan.id,
            planDigest: facts.plan.artifactDigest,
            operation: facts.input,
            expiresAt: facts.plan.expiresAt.toISOString(),
            checks: output.checks,
          } as const);
        },
        true,
      ),
    review: () => Promise.reject(unavailable()),
    withAuthority: ({ siteId, target, actor, decision, mutate }) =>
      withApprovalTarget(siteId, target, actor, (ctx, facts) =>
        mutate(ctx.db, {
          verify: async (statement) => {
            if (!["approval_pending", "approved"].includes(facts.action.state)) throw conflict();
            await assertStatement(ctx, facts, statement, "request-approval");
          },
          transition: async (state) => {
            await ctx.db
              .update(npAgentActions)
              .set({
                state: state === "approved" ? "approved" : "failed",
                errorCode:
                  state === "approved"
                    ? null
                    : decision === "reject"
                      ? "APPROVAL_REJECTED"
                      : "APPROVAL_REVOKED",
                finishedAt: state === "approved" ? null : ctx.time,
              })
              .where(eq(npAgentActions.id, facts.action.id));
            if (state !== "approved")
              await failRuntimePlan(
                ctx.db,
                facts.original,
                decision === "reject" ? "APPROVAL_REJECTED" : "APPROVAL_REVOKED",
                ctx.time,
              );
          },
        }),
      ),
    revalidate: ({ siteId, statement }) =>
      withApprovalTarget(siteId, statement.target, undefined, async (ctx, facts) => {
        await assertStatement(ctx, facts, statement, "request-approval");
        const [approval] = await ctx.db
          .select()
          .from(npAgentApprovals)
          .where(eq(npAgentApprovals.id, statement.approvalId))
          .for("update");
        if (approval?.state === "approved") {
          if (!approval.decidedByUserId) throw unavailable();
          await liveApprover(ctx.db, facts, approval.decidedByUserId);
        }
      }),
    expire: async ({ siteId, target, mutate }) => {
      if (target.kind !== "action") throw unavailable();
      return database().transaction(async (db) => {
        await npWithAgentRuntimeControlTransactionV1(siteId, () => Promise.resolve(undefined), db);
        const [action] = await db
          .select()
          .from(npAgentActions)
          .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, target.actionId)))
          .for("update");
        if (
          !action ||
          action.capabilityId !== "ops.execute" ||
          action.inputHash !== target.proposalHash
        )
          throw conflict();
        return mutate(db, {
          verify: () => Promise.resolve(undefined),
          transition: async () => {
            if (["approval_pending", "approved"].includes(action.state))
              await db
                .update(npAgentActions)
                .set({ state: "failed", errorCode: "APPROVAL_EXPIRED", finishedAt: now() })
                .where(eq(npAgentActions.id, action.id));
            const [original] = await db
              .select()
              .from(npAgentInvocations)
              .where(
                and(
                  eq(npAgentInvocations.siteId, siteId),
                  eq(npAgentInvocations.id, action.invocationId!),
                ),
              )
              .limit(1);
            if (original) await failRuntimePlan(db, original, "APPROVAL_EXPIRED", now());
          },
        });
      });
    },
  };

  async function plan(actor: ActorContext, row: Invocation, input: NpAgentOpsPlanInputV1) {
    if (!options.host.plan) throw unavailable();
    const planId = randomUUID();
    const artifact = await bounded(options.host.plan({ ...context(actor, row.id), input, planId }));
    await access(actor, "ops.plan", input, row.id);
    const canonical = serializeAgentCanonicalJson(artifact.artifact);
    if (
      typeof artifact.artifact !== "object" ||
      !artifact.artifact ||
      Array.isArray(artifact.artifact) ||
      Buffer.byteLength(canonical) > 1048576
    )
      throw conflict();
    const artifactCanonical = JSON.parse(canonical) as NpAgentJsonObject;
    const planDigest = digest("np.agent-operator-plan-artifact.v1", {
      operation: input,
      contractId: artifact.contractId,
      artifact: artifactCanonical,
    });
    const expiresAt = new Date(
      Math.min(actor.time.getTime() + 3600000, actor.runtime?.run.deadlineAt.getTime() ?? Infinity),
    );
    const approval = executable(input)
      ? await executionStatement(actor, row, planId, planDigest, input, expiresAt)
      : null;
    const output = npRequireAgentOperatorCapabilityOutputV1("ops.plan", {
      schemaVersion: "np.agent-ops-plan.v1",
      planId,
      planDigest,
      operation: input,
      checks: artifact.checks,
      expiresAt: expiresAt.toISOString(),
      execution: approval
        ? {
            kind: "agent-executable",
            approvalId: approval.approvalId,
            approvalResource: `/admin/agents/approvals/${approval.approvalId}`,
          }
        : {
            kind: "local-cli-handoff",
            contractId: artifact.contractId,
            planArtifactId: planId,
            projectCommand: artifact.projectCommand,
          },
    });
    await actor.db.insert(npAgentOperatorPlans).values({
      id: planId,
      approvalActionId: approval?.actionId ?? null,
      siteId: row.siteId,
      invocationId: row.id,
      auditEventId: row.auditEventId,
      operation: json(input),
      contractId: artifact.contractId,
      artifactCanonical,
      artifactDigest: planDigest,
      createdAt: actor.time,
      expiresAt,
    });
    await complete(actor, row, output);
    if (approval && actor.runtime)
      await actor.db
        .update(npAgentActions)
        .set({ state: "approval_pending", finishedAt: null })
        .where(and(eq(npAgentActions.siteId, row.siteId), eq(npAgentActions.id, row.resultId!)));
    return output;
  }
  type PendingExecution = { pendingExecutionId: string; siteId: string; invocationId: string };
  async function reserveExecution(
    actor: ActorContext,
    row: Invocation,
    input: NpAgentOpsExecuteInputV1,
  ): Promise<PendingExecution> {
    if (!options.resolveApprovals) throw unavailable();
    const facts = await planEvidence(actor.db, row.siteId, input.planId, actor.time);
    const original = facts.original;
    if (
      input.planDigest !== facts.plan.artifactDigest ||
      input.approvalId !== facts.action.approvalId ||
      facts.action.state !== "approved" ||
      facts.action.executionInvocationId ||
      original.principalId !== actor.principal.principalId ||
      original.authorizationContextFingerprint !== actor.authorizationContextFingerprint
    )
      throw conflict();
    const operation: NpAgentExecutableOpsPlanInputV1 =
      input.action === "cache.revalidate"
        ? { action: input.action, target: input.target }
        : {
            action: input.action,
            target: {
              kind: "run",
              runId: input.action === "agent.run.retry" ? input.failedRunId : input.runId,
            },
          };
    if (!same(operation, facts.input)) throw conflict();
    await access(actor, "ops.execute", facts.input, row.id);
    const [approval] = await actor.db
      .select()
      .from(npAgentApprovals)
      .where(
        and(eq(npAgentApprovals.siteId, row.siteId), eq(npAgentApprovals.id, input.approvalId)),
      )
      .for("update");
    if (!approval || !approval.decidedByUserId) throw conflict();
    const checked = await options.resolveApprovals().verify(approval);
    await assertStatement(actor, facts, checked.statement, "execute-approved");
    await liveApprover(actor.db, facts, approval.decidedByUserId);
    await options.resolveApprovals().consumeAction({
      db: actor.db,
      siteId: row.siteId,
      id: approval.id,
      actionId: facts.action.id,
      proposalHash: facts.action.inputHash,
      statementHash: approval.statementHash,
      consumedAt: actor.time,
    });
    const id = randomUUID();
    await actor.db.insert(npAgentOperatorExecutions).values({
      id,
      siteId: row.siteId,
      planId: facts.plan.id,
      invocationId: row.id,
      actionId: facts.action.id,
      state: "reserved",
      reservedAt: actor.time,
      sourceRunId: facts.input.target.kind === "run" ? facts.input.target.runId : null,
    });
    await actor.db
      .update(npAgentActions)
      .set({
        state: "executing",
        executionInvocationId: row.id,
        executionInvocationFingerprint: row.requestHash,
        startedAt: actor.time,
      })
      .where(eq(npAgentActions.id, facts.action.id));
    await actor.db
      .update(npAgentInvocations)
      .set({ state: "accepted" })
      .where(eq(npAgentInvocations.id, row.id));
    await actor.db
      .update(npAgentActions)
      .set({ state: "executing" })
      .where(and(eq(npAgentActions.siteId, row.siteId), eq(npAgentActions.invocationId, row.id)));
    return { pendingExecutionId: id, siteId: row.siteId, invocationId: row.id };
  }
  async function finishExecution(
    pending: PendingExecution,
  ): Promise<NpAgentOperatorCapabilityInvocationResultV1 & { task?: NpAgentMcpTaskV1 }> {
    const [invocation] = await database()
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, pending.siteId),
          eq(npAgentInvocations.id, pending.invocationId),
        ),
      )
      .limit(1);
    if (!invocation || invocation.operationId !== "ops.execute") throw conflict();
    const dispatch = await withOriginal(invocation, async (actor) => {
      const [execution] = await actor.db
        .select()
        .from(npAgentOperatorExecutions)
        .where(
          and(
            eq(npAgentOperatorExecutions.siteId, pending.siteId),
            eq(npAgentOperatorExecutions.id, pending.pendingExecutionId),
          ),
        )
        .for("update")
        .limit(1);
      if (!execution || execution.invocationId !== invocation.id) throw conflict();
      const input = npRequireAgentOperatorCapabilityInputV1(
        "ops.execute",
        invocation.requestBody.input,
      );
      await access(actor, "ops.execute", input, invocation.id);
      if (execution.planId !== input.planId) throw conflict();
      if (execution.resultCanonical) {
        const output = npRequireAgentOperatorCapabilityOutputV1(
          "ops.execute",
          execution.resultCanonical,
        );
        if (
          !same(execution.resultCanonical, invocation.outputRedacted) ||
          output.planId !== execution.planId ||
          output.action !== input.action ||
          output.resultDigest !== execution.resultDigest ||
          digest("np.agent-operator-execution-result.v1", {
            planId: output.planId,
            action: output.action,
            state: output.state,
            evidence: execution.evidenceCanonical,
            verificationRefs: output.verificationRefs,
          }) !== output.resultDigest
        )
          throw conflict();
        return {
          result: await replay(actor, invocation, "ops.execute", input, invocation.requestHash),
        };
      }
      if (execution.state !== "reserved") throw conflict();
      const facts = await planEvidence(actor.db, pending.siteId, execution.planId, actor.time);
      if (
        facts.action.executionInvocationId !== invocation.id ||
        facts.action.executionInvocationFingerprint !== invocation.requestHash ||
        facts.original.principalId !== actor.principal.principalId ||
        facts.original.authorizationContextFingerprint !== actor.authorizationContextFingerprint
      )
        throw conflict();
      const [approval] = await actor.db
        .select()
        .from(npAgentApprovals)
        .where(eq(npAgentApprovals.id, input.approvalId))
        .for("update");
      if (
        !approval ||
        approval.state !== "consumed" ||
        !approval.decidedByUserId ||
        !options.resolveApprovals
      )
        throw conflict();
      const checked = await options.resolveApprovals().verify(approval);
      await assertStatement(actor, facts, checked.statement, "execute-approved");
      await liveApprover(actor.db, facts, approval.decidedByUserId);
      await access(actor, "ops.execute", facts.input, invocation.id);
      await actor.db
        .update(npAgentOperatorExecutions)
        .set({ state: "dispatching", dispatchedAt: actor.time })
        .where(eq(npAgentOperatorExecutions.id, execution.id));
      return {
        hostContext: { ...context(actor, invocation.id), db: database(), transaction: undefined },
        facts,
        executionId: execution.id,
      };
    });
    if ("result" in dispatch && dispatch.result) return dispatch.result;
    if (!("facts" in dispatch) || !options.host.execute) throw unavailable();
    let result: NpAgentOperatorExecutionResultV1;
    try {
      result = await bounded(
        options.host.execute({
          ...dispatch.hostContext,
          input: dispatch.facts.input,
          artifact: dispatch.facts.plan.artifactCanonical,
          contractId: dispatch.facts.plan.contractId,
          executionId: dispatch.executionId,
        }),
      );
      // Validate and canonicalize the bounded private evidence before retaining it.
      const bytes = serializeAgentCanonicalJson(result.evidence);
      if (!result.evidence || Array.isArray(result.evidence) || Buffer.byteLength(bytes) > 1048576)
        throw conflict();
      result = { ...result, evidence: JSON.parse(bytes) as NpAgentJsonObject };
    } catch {
      await database()
        .update(npAgentOperatorExecutions)
        .set({ state: "unknown" })
        .where(
          and(
            eq(npAgentOperatorExecutions.siteId, pending.siteId),
            eq(npAgentOperatorExecutions.id, pending.pendingExecutionId),
            eq(npAgentOperatorExecutions.state, "dispatching"),
          ),
        );
      throw new NpAgentGatewayError(
        "CONFLICT",
        409,
        "Operator execution outcome requires reconciliation.",
      );
    }
    const output = npRequireAgentOperatorCapabilityOutputV1("ops.execute", {
      schemaVersion: "np.agent-ops-execution.v1",
      planId: dispatch.facts.plan.id,
      action: dispatch.facts.input.action,
      state: result.state,
      resultDigest: digest("np.agent-operator-execution-result.v1", {
        planId: dispatch.facts.plan.id,
        action: dispatch.facts.input.action,
        state: result.state,
        evidence: result.evidence,
        verificationRefs: result.verificationRefs,
      }),
      verificationRefs: result.verificationRefs,
    });
    // Persist the actual outcome even if requester authority changed during the external call.
    await database().transaction(async (db) => {
      const [execution] = await db
        .select()
        .from(npAgentOperatorExecutions)
        .where(
          and(
            eq(npAgentOperatorExecutions.siteId, pending.siteId),
            eq(npAgentOperatorExecutions.id, pending.pendingExecutionId),
          ),
        )
        .for("update");
      if (!execution || execution.state !== "dispatching") throw conflict();
      const time = now();
      await db
        .update(npAgentOperatorExecutions)
        .set({
          state: result.state,
          finishedAt: time,
          resultCanonical: json(output),
          evidenceCanonical: result.evidence,
          resultDigest: output.resultDigest,
          ...(typeof result.evidence.resultRunId === "string"
            ? { resultRunId: result.evidence.resultRunId }
            : {}),
        })
        .where(eq(npAgentOperatorExecutions.id, execution.id));
      if (dispatch.facts.original.runId)
        await db
          .update(npAgentActions)
          .set({
            state: result.state === "succeeded" ? "succeeded" : "failed",
            finishedAt: time,
            errorCode: result.state === "succeeded" ? null : "OPERATOR_EXECUTION_FAILED",
          })
          .where(
            and(
              eq(npAgentActions.siteId, pending.siteId),
              eq(npAgentActions.id, dispatch.facts.original.resultId!),
            ),
          );
      const outputHash = digest("np.agent-capability-output.v1", output);
      await db
        .update(npAgentInvocations)
        .set({ state: "completed", outputRedacted: json(output), outputHash, completedAt: time })
        .where(eq(npAgentInvocations.id, invocation.id));
      await db
        .update(npAgentActions)
        .set({
          state: result.state === "succeeded" ? "succeeded" : "failed",
          errorCode:
            result.state === "succeeded"
              ? null
              : result.state === "conflicted"
                ? "OPERATOR_EXECUTION_CONFLICT"
                : "OPERATOR_EXECUTION_FAILED",
          outputRedacted: json(output),
          outputHash,
          finishedAt: time,
        })
        .where(
          and(
            eq(npAgentActions.siteId, pending.siteId),
            sql`(${npAgentActions.id} = ${execution.actionId} or ${npAgentActions.invocationId} = ${invocation.id})`,
          ),
        );
      await db
        .update(npAuditEvents)
        .set({
          payload: {
            schemaVersion: "np.agent-operator-audit.v1",
            capabilityId: "ops.execute",
            invocationId: invocation.id,
            requestHash: invocation.requestHash,
            outcome: "completed",
            outputDigest: outputHash,
          },
        })
        .where(eq(npAuditEvents.id, invocation.auditEventId));
    });
    return withOriginal(invocation, async (actor) => {
      await access(actor, "ops.execute", dispatch.facts.input, invocation.id);
      return {
        schemaVersion: "np.agent-operator-invocation-result.v1",
        invocationId: invocation.id,
        capabilityId: "ops.execute",
        output,
      };
    });
  }

  async function request(
    actor: ActorContext,
    req: NpAgentOperatorCapabilityInvocationRequestV1,
    taskRequest?: NpAgentMcpTaskRequestV1,
  ): Promise<
    (NpAgentOperatorCapabilityInvocationResultV1 & { task?: NpAgentMcpTaskV1 }) | PendingExecution
  > {
    const id = req.capabilityId;
    const parsed = npRequireAgentOperatorCapabilityInputV1(id, req.arguments.input);
    requireEnabled(id, parsed);
    const key = req.arguments.idempotencyKey;
    if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(key))
      throw conflict();
    if (
      taskRequest &&
      (!actor.authentication ||
        !options.tasks ||
        id !== "audit.run" ||
        !["mcp-service", "mcp-oauth", "stdio"].includes(actor.authorizationContext.transport))
    )
      throw unavailable();
    const entry = await definition(id);
    const requiredScopes = [...entry.descriptor.requiredScopes] as NpAgentScope[];
    const requestBody = npRequireAgentInvocationRequestCanonical({
      schemaVersion: "np.agent-idempotency-request.v1",
      siteId: actor.principal.siteId,
      actorKind: "principal",
      actorFingerprint: actor.authorizationContext.actor.actorFingerprint,
      authorizationContextFingerprint: actor.authorizationContextFingerprint,
      operationKind: "capability",
      operationId: id,
      contractVersion: 1,
      contractFingerprint: entry.fingerprint,
      effectProfile: {
        id: id === "ops.execute" ? "ops.execute" : "domain.read",
        contractVersion: 1,
      },
      input: json(parsed),
    });
    const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
    await actor.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-operator:${actor.principal.siteId}:${actor.principal.principalId}:${key}`},0))`,
    );
    const [prior] = await actor.db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, actor.principal.siteId),
          eq(npAgentInvocations.actorFingerprint, requestBody.actorFingerprint),
          eq(
            npAgentInvocations.authorizationContextFingerprint,
            actor.authorizationContextFingerprint,
          ),
          eq(npAgentInvocations.operationId, id),
          eq(npAgentInvocations.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (prior) {
      if (
        prior.mcpExecutionMode !==
        (taskRequest
          ? "task"
          : ["mcp-service", "mcp-oauth", "stdio"].includes(actor.authorizationContext.transport)
            ? "normal"
            : null)
      )
        throw conflict();
      if (id === "ops.execute" && prior.requestHash === requestHash) {
        await access(actor, id, parsed, prior.id);
        const [execution] = await actor.db
          .select()
          .from(npAgentOperatorExecutions)
          .where(
            and(
              eq(npAgentOperatorExecutions.siteId, prior.siteId),
              eq(npAgentOperatorExecutions.invocationId, prior.id),
            ),
          )
          .limit(1);
        if (!execution) throw conflict();
        return { pendingExecutionId: execution.id, siteId: prior.siteId, invocationId: prior.id };
      }
      const result = await replay(actor, prior, id, parsed, requestHash);
      const task =
        taskRequest && actor.authentication && options.tasks
          ? await options.tasks.replayInTransaction(actor.db, {
              authentication: actor.authentication,
              invocationId: prior.id,
              taskRequest,
            })
          : undefined;
      if (prior.state === "accepted") await schedule(prior);
      return {
        ...result,
        ...(task ? { task } : {}),
      };
    }
    if (actor.runtime) {
      const [used] = await actor.db
        .select({ total: count() })
        .from(npAgentActions)
        .where(
          and(
            eq(npAgentActions.siteId, actor.principal.siteId),
            eq(npAgentActions.runId, actor.runtime.run.id),
          ),
        );
      if (used.total >= actor.runtime.limits.maxCapabilityCalls)
        throw new NpAgentGatewayError(
          "RUNTIME_BUDGET_EXCEEDED",
          409,
          "Runtime action limit reached.",
        );
    }
    const admit = async () => {
      const invocationId = randomUUID(),
        actionId = randomUUID(),
        auditId = randomUUID();
      await access(actor, id, parsed, invocationId);
      const action = npRequireAgentActionCanonical({
        schemaVersion: "np.agent-action.v1",
        siteId: actor.principal.siteId,
        actionId,
        invocationFingerprint: requestHash,
        runFingerprint: actor.runtime?.run.admissionFingerprint ?? null,
        sequence: actor.sequence,
        capabilityId: id,
        capabilityContractVersion: 1,
        capabilityFingerprint: entry.fingerprint,
        effectProfile: {
          id: id === "ops.execute" ? "ops.execute" : "domain.read",
          contractVersion: 1,
        },
        risk: id === "ops.execute" ? "sensitive" : "read",
        requiredScopes,
        targetRefs:
          id === "ops.execute" && "action" in parsed
            ? [{ kind: "ops", action: parsed.action }]
            : [],
        targetVersionFacts:
          id === "ops.execute" && "planDigest" in parsed
            ? [
                {
                  targetRef: { kind: "ops", action: parsed.action },
                  versionDigest: parsed.planDigest,
                },
              ]
            : [],
        input: json(parsed),
      });
      await actor.db.insert(npAuditEvents).values({
        id: auditId,
        siteId: actor.principal.siteId,
        actorKind: "agent-principal",
        action: "agents.capability.invoke",
        targetType: "agent-capability",
        targetId: id,
        payload: {
          schemaVersion: "np.agent-operator-audit.v1",
          capabilityId: id,
          invocationId,
          requestHash,
          outcome: id === "audit.run" ? "queued" : "started",
        },
        createdAt: actor.time,
      });
      const [row] = await actor.db
        .insert(npAgentInvocations)
        .values({
          id: invocationId,
          siteId: actor.principal.siteId,
          actorKind: "principal",
          principalId: actor.principal.principalId,
          actorFingerprint: requestBody.actorFingerprint,
          authorizationContextBody: actor.authorizationContext,
          authorizationContextFingerprint: actor.authorizationContextFingerprint,
          authorityRef: actor.authorizationContext.authorityRef,
          operationKind: "capability",
          operationId: id,
          contractVersion: 1,
          contractFingerprint: entry.fingerprint,
          capabilityDefinitionBody: entry.canonical,
          effectProfileId: id === "ops.execute" ? "ops.execute" : "domain.read",
          effectContractVersion: 1,
          transport: actor.authorizationContext.transport,
          mcpExecutionMode: taskRequest
            ? "task"
            : ["mcp-service", "mcp-oauth", "stdio"].includes(actor.authorizationContext.transport)
              ? "normal"
              : null,
          mcpRequestedTaskTtlMs: taskRequest
            ? (taskRequest.requestedTtlMs ?? npAgentMcpTaskLimitsV1.ttlDefaultMs)
            : null,
          idempotencyKey: key,
          requestBody,
          requestHash,
          state: "started",
          runId: actor.runtime?.run.id ?? null,
          resultKind: "action",
          resultId: actionId,
          auditEventId: auditId,
          requestedAt: actor.time,
          expiresAt: new Date(actor.time.getTime() + 86400000),
        })
        .returning();
      if (!row) throw conflict();
      await actor.db.insert(npAgentActions).values({
        id: actionId,
        siteId: row.siteId,
        runId: row.runId,
        runFingerprint: actor.runtime?.run.admissionFingerprint ?? null,
        invocationId,
        invocationFingerprint: requestHash,
        sequence: actor.sequence,
        capabilityId: id,
        capabilityContractVersion: 1,
        capabilityFingerprint: entry.fingerprint,
        capabilityDefinitionBody: entry.canonical,
        effectProfileId: id === "ops.execute" ? "ops.execute" : "domain.read",
        effectContractVersion: 1,
        risk: id === "ops.execute" ? "sensitive" : "read",
        state: id === "ops.execute" ? "proposed" : "executing",
        idempotencyKey: key,
        inputRedacted: json(parsed),
        inputCanonical: json(parsed),
        requiredScopes,
        targetRefs: action.targetRefs,
        targetVersionFacts: action.targetVersionFacts,
        inputHash: await npDigestAgentActionCanonical(action),
        auditEventId: auditId,
        startedAt: actor.time,
        createdAt: actor.time,
      });
      if (id === "ops.execute")
        return reserveExecution(actor, row, parsed as NpAgentOpsExecuteInputV1);
      let output: NpAgentAuditRunOutputV1 | NpAgentOpsPlanOutputV1;
      if (id === "audit.run") {
        output = npRequireAgentOperatorCapabilityOutputV1(id, {
          schemaVersion: "np.agent-audit.v1",
          auditId,
          state: "queued",
          checks: [],
          digest: null,
        });
        await actor.db
          .update(npAgentInvocations)
          .set({
            state: "accepted",
            outputRedacted: json(output),
            outputHash: digest("np.agent-capability-output.v1", output),
          })
          .where(eq(npAgentInvocations.id, invocationId));
        if (actor.runtime) {
          await executeAudit(actor, { ...row, state: "accepted" });
          const [completed] = await actor.db
            .select()
            .from(npAgentInvocations)
            .where(eq(npAgentInvocations.id, invocationId))
            .limit(1);
          if (!completed?.outputRedacted || completed.state !== "completed") throw conflict();
          output = npRequireAgentOperatorCapabilityOutputV1("audit.run", completed.outputRedacted);
        } else await schedule(row);
      } else output = await plan(actor, row, parsed as NpAgentOpsPlanInputV1);
      return {
        schemaVersion: "np.agent-operator-invocation-result.v1" as const,
        invocationId,
        capabilityId: id,
        output,
      };
    };
    if (taskRequest && actor.authentication && options.tasks) {
      const admitted = await options.tasks.admitInTransaction(actor.db, {
        authentication: actor.authentication,
        taskRequest,
        admit,
      });
      if ("pendingExecutionId" in admitted.value) throw conflict();
      return {
        ...admitted.value,
        task: admitted.task,
      };
    }
    return await admit();
  }
  async function schedule(row: Pick<Invocation, "id" | "siteId">) {
    await runPostCommit(
      "agent operator audit",
      { collection: "np_agent_invocations", documentId: row.id },
      async () => {
        const jobId = await options.enqueueAudit?.({ siteId: row.siteId, invocationId: row.id });
        if (!jobId) throw new Error("Operator audit producer is unavailable.");
      },
    );
  }
  async function executeAudit(actor: ActorContext, row: Invocation) {
    await actor.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-operator-worker:${row.siteId}:${row.id}`},0))`,
    );
    // Match the MCP cancellation owner: task before invocation. Authority locks
    // are already held by the admission seam for both paths.
    if (row.mcpExecutionMode === "task") {
      await actor.db
        .select({ id: npAgentMcpTasks.id })
        .from(npAgentMcpTasks)
        .where(
          and(eq(npAgentMcpTasks.siteId, row.siteId), eq(npAgentMcpTasks.invocationId, row.id)),
        )
        .for("update");
    }
    const [live] = await actor.db
      .select()
      .from(npAgentInvocations)
      .where(and(eq(npAgentInvocations.siteId, row.siteId), eq(npAgentInvocations.id, row.id)))
      .for("update")
      .limit(1);
    if (!live || live.operationId !== "audit.run") throw conflict();
    const parsed = npRequireAgentOperatorCapabilityInputV1("audit.run", live.requestBody.input);
    if (live.state === "completed") {
      await replay(actor, live, "audit.run", parsed, live.requestHash);
      return;
    }
    if (
      live.state !== "accepted" ||
      live.expiresAt <= actor.time ||
      !options.host.audit ||
      live.authorizationContextFingerprint !== actor.authorizationContextFingerprint ||
      (await npDigestAgentInvocationRequestCanonical(
        npRequireAgentInvocationRequestCanonical(live.requestBody),
      )) !== live.requestHash
    )
      throw conflict();
    if (live.mcpExecutionMode === "task") {
      const [task] = await actor.db
        .select()
        .from(npAgentMcpTasks)
        .where(
          and(eq(npAgentMcpTasks.siteId, live.siteId), eq(npAgentMcpTasks.invocationId, live.id)),
        )
        .for("update")
        .limit(1);
      if (!task || task.status !== "working" || task.expiresAt <= actor.time) throw conflict();
    }
    await replay(actor, live, "audit.run", parsed, live.requestHash);
    const result = await bounded(
      options.host.audit({
        ...context(actor, live.id),
        input: parsed,
        auditId: live.auditEventId,
      }),
    );
    await access(actor, "audit.run", parsed, live.id);
    if (
      result.checks.some((check) => !parsed.families.includes(check.family)) ||
      parsed.families.some((family) => !result.checks.some((check) => check.family === family))
    )
      throw conflict();
    if (live.expiresAt.getTime() <= Math.max(actor.time.getTime(), now().getTime()))
      throw conflict();
    if (live.mcpExecutionMode === "task") {
      const [task] = await actor.db
        .select()
        .from(npAgentMcpTasks)
        .where(
          and(eq(npAgentMcpTasks.siteId, live.siteId), eq(npAgentMcpTasks.invocationId, live.id)),
        )
        .limit(1);
      if (
        !task ||
        task.status !== "working" ||
        task.expiresAt.getTime() <= Math.max(actor.time.getTime(), now().getTime())
      )
        throw conflict();
    }
    const output = npRequireAgentOperatorCapabilityOutputV1("audit.run", {
      schemaVersion: "np.agent-audit.v1",
      auditId: live.auditEventId,
      state: "completed",
      checks: result.checks,
      digest: digest("np.agent-operator-audit-evidence.v1", {
        siteId: live.siteId,
        auditId: live.auditEventId,
        input: parsed,
        checks: result.checks,
      }),
    });
    await complete(actor, live, output);
  }
  async function terminalize(job: NpAgentOperatorAuditJobV1) {
    if (!options.tasks) return;
    const [row] = await database()
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, job.siteId), eq(npAgentInvocations.id, job.invocationId)),
      )
      .limit(1);
    if (!row || row.state !== "completed" || !row.outputRedacted) return;
    const [task] = await database()
      .select()
      .from(npAgentMcpTasks)
      .where(and(eq(npAgentMcpTasks.siteId, job.siteId), eq(npAgentMcpTasks.invocationId, row.id)))
      .limit(1);
    if (task)
      await options.tasks.terminalize({
        taskId: task.id,
        status: "completed",
        result: {
          schemaVersion: "np.agent-mcp-stored-task-result.v1",
          kind: "tool_result",
          result: {
            content: [{ type: "text", text: JSON.stringify(row.outputRedacted) }],
            structuredContent: json(row.outputRedacted),
          },
        },
      });
  }
  async function processAudit(job: NpAgentOperatorAuditJobV1) {
    npAssertAgentPreviewEffectsAllowed();
    parseJob(job);
    const [row] = await database()
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, job.siteId), eq(npAgentInvocations.id, job.invocationId)),
      )
      .limit(1);
    if (!row || row.operationId !== "audit.run") throw conflict();
    await withCurrentSite(job.siteId, async () => {
      if (row.transport === "runtime") {
        if (!row.runId || !options.runtimeAdmission) throw unavailable();
        await options.runtimeAdmission.withRunAuthority(
          { siteId: job.siteId, runId: row.runId },
          async (runtime) => executeAudit(await runtimeActor(runtime, 1), row),
        );
      } else
        await options.admission.withStoredAuthority({
          authorizationContext: row.authorizationContextBody,
          authorizationContextFingerprint: row.authorizationContextFingerprint,
          requiredScopes: ["audit:run"],
          minimumExposure: "read",
          resolveTransportAudience: options.resolveTransportAudience,
          mutate: async (db, time, authentication) =>
            executeAudit(
              {
                db,
                time,
                authentication,
                sequence: 1,
                principal: principal(authentication),
                authorizationContext: authentication.authorizationContext,
                authorizationContextFingerprint: authentication.authorizationContextFingerprint,
              },
              row,
            ),
        });
    });
    await terminalize(job);
  }
  async function refreshInvocation(job: NpAgentOperatorAuditJobV1) {
    parseJob(job);
    const [row] = await database()
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, job.siteId), eq(npAgentInvocations.id, job.invocationId)),
      )
      .limit(1);
    if (!row || row.operationId !== "audit.run") throw conflict();
    await withCurrentSite(job.siteId, () =>
      options.admission.withStoredAuthority({
        authorizationContext: row.authorizationContextBody,
        authorizationContextFingerprint: row.authorizationContextFingerprint,
        requiredScopes: ["audit:run"],
        minimumExposure: "read",
        resolveTransportAudience: options.resolveTransportAudience,
        mutate: async (db, time, authentication) => {
          const [current] = await db
            .select()
            .from(npAgentInvocations)
            .where(
              and(
                eq(npAgentInvocations.siteId, job.siteId),
                eq(npAgentInvocations.id, job.invocationId),
              ),
            )
            .limit(1);
          if (!current) throw conflict();
          await replay(
            {
              db,
              time,
              authentication,
              sequence: 1,
              principal: principal(authentication),
              authorizationContext: authentication.authorizationContext,
              authorizationContextFingerprint: authentication.authorizationContextFingerprint,
            },
            current,
            "audit.run",
            npRequireAgentOperatorCapabilityInputV1("audit.run", current.requestBody.input),
            current.requestHash,
          );
        },
      }),
    );
    await terminalize(job);
  }
  function parseJob(value: unknown): NpAgentOperatorAuditJobV1 {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw conflict();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => !["siteId", "invocationId"].includes(key)) ||
      typeof row.siteId !== "string" ||
      !npIsCanonicalSiteId(row.siteId) ||
      typeof row.invocationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(row.invocationId)
    )
      throw conflict();
    return { siteId: row.siteId, invocationId: row.invocationId };
  }
  options.tasks?.registerInvocationReadGuard(
    "audit.run",
    async ({ authentication, siteId, invocationId }) => {
      if (siteId !== authentication.principal.siteId) throw conflict();
      await options.admission.withCurrentAuthority({
        authentication,
        requiredScopes: ["audit:run"],
        minimumExposure: "read",
        mutate: async (db, time) => {
          const [row] = await db
            .select()
            .from(npAgentInvocations)
            .where(
              and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, invocationId)),
            )
            .limit(1);
          if (
            !row ||
            row.operationId !== "audit.run" ||
            row.authorizationContextFingerprint !== authentication.authorizationContextFingerprint
          )
            throw conflict();
          const actor = {
            db,
            time,
            authentication,
            sequence: 1,
            principal: principal(authentication),
            authorizationContext: authentication.authorizationContext,
            authorizationContextFingerprint: authentication.authorizationContextFingerprint,
          };
          const parsed = npRequireAgentOperatorCapabilityInputV1(
            "audit.run",
            row.requestBody.input,
          );
          if (row.state === "failed" && row.errorCode === "OPERATOR_CANCELLED") {
            if (
              (await npDigestAgentInvocationRequestCanonical(
                npRequireAgentInvocationRequestCanonical(row.requestBody),
              )) !== row.requestHash
            )
              throw conflict();
            await access(actor, "audit.run", parsed, row.id);
          } else await replay(actor, row, "audit.run", parsed, row.requestHash);
        },
      });
    },
    {
      requiredScopes: ["audit:run"],
      minimumExposure: "read",
      mutate: async ({ db, authentication, siteId, invocationId, now: time }) => {
        const [row] = await db
          .select()
          .from(npAgentInvocations)
          .where(
            and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, invocationId)),
          )
          .for("update")
          .limit(1);
        if (
          !row ||
          row.state !== "accepted" ||
          row.operationId !== "audit.run" ||
          row.authorizationContextFingerprint !== authentication.authorizationContextFingerprint
        )
          return false;
        await replay(
          {
            db,
            time,
            authentication,
            sequence: 1,
            principal: principal(authentication),
            authorizationContext: authentication.authorizationContext,
            authorizationContextFingerprint: authentication.authorizationContextFingerprint,
          },
          row,
          "audit.run",
          npRequireAgentOperatorCapabilityInputV1("audit.run", row.requestBody.input),
          row.requestHash,
        );
        await db
          .update(npAgentInvocations)
          .set({ state: "failed", errorCode: "OPERATOR_CANCELLED", completedAt: time })
          .where(eq(npAgentInvocations.id, row.id));
        await db
          .update(npAgentActions)
          .set({ state: "failed", errorCode: "OPERATOR_CANCELLED", finishedAt: time })
          .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.invocationId, row.id)));
        await db
          .update(npAuditEvents)
          .set({
            payload: {
              schemaVersion: "np.agent-operator-audit.v1",
              capabilityId: "audit.run",
              invocationId,
              requestHash: row.requestHash,
              outcome: "cancelled",
            },
          })
          .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.id, row.auditEventId)));
        return true;
      },
    },
  );
  async function runtimeApprovalEvidence(
    runtime: NpAgentRuntimeRunContextV1,
    requestActionId: string,
  ) {
    const actor = await runtimeActor(runtime, 1);
    const [primary] = await runtime.db
      .select()
      .from(npAgentActions)
      .where(
        and(
          eq(npAgentActions.siteId, runtime.siteId),
          eq(npAgentActions.runId, runtime.run.id),
          eq(npAgentActions.id, requestActionId),
        ),
      )
      .limit(1);
    if (
      !primary ||
      primary.capabilityId !== "ops.plan" ||
      primary.approvalId !== null ||
      !primary.invocationId ||
      !["approval_pending", "approved", "succeeded"].includes(primary.state)
    )
      throw conflict();
    const [plan] = await runtime.db
      .select()
      .from(npAgentOperatorPlans)
      .where(
        and(
          eq(npAgentOperatorPlans.siteId, runtime.siteId),
          eq(npAgentOperatorPlans.invocationId, primary.invocationId),
        ),
      )
      .limit(1);
    if (!plan || !options.resolveApprovals) throw conflict();
    const facts = await planEvidence(runtime.db, runtime.siteId, plan.id, runtime.now);
    if (
      facts.original.runId !== runtime.run.id ||
      facts.original.transport !== "runtime" ||
      facts.original.resultId !== primary.id ||
      facts.original.authorizationContextFingerprint !== actor.authorizationContextFingerprint ||
      !facts.action.approvalId ||
      primary.runFingerprint !== runtime.run.admissionFingerprint ||
      primary.outputHash !== facts.original.outputHash ||
      !same(primary.outputRedacted, facts.original.outputRedacted)
    )
      throw conflict();
    const canonical = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId: primary.siteId,
      actionId: primary.id,
      invocationFingerprint: primary.invocationFingerprint,
      runFingerprint: primary.runFingerprint,
      sequence: primary.sequence,
      capabilityId: primary.capabilityId,
      capabilityContractVersion: primary.capabilityContractVersion,
      capabilityFingerprint: primary.capabilityFingerprint,
      effectProfile: {
        id: primary.effectProfileId,
        contractVersion: primary.effectContractVersion,
      },
      risk: primary.risk,
      requiredScopes: primary.requiredScopes,
      targetRefs: primary.targetRefs,
      targetVersionFacts: primary.targetVersionFacts,
      input: primary.inputCanonical,
    });
    if (
      (await npDigestAgentActionCanonical(canonical)) !== primary.inputHash ||
      primary.invocationFingerprint !== facts.original.requestHash ||
      primary.capabilityFingerprint !== facts.original.contractFingerprint ||
      !same(primary.capabilityDefinitionBody, facts.original.capabilityDefinitionBody) ||
      !same(primary.inputCanonical, facts.original.requestBody.input)
    )
      throw conflict();
    await replay(actor, facts.original, "ops.plan", facts.input, facts.original.requestHash);
    const [approval] = await runtime.db
      .select()
      .from(npAgentApprovals)
      .where(
        and(
          eq(npAgentApprovals.siteId, runtime.siteId),
          eq(npAgentApprovals.id, facts.action.approvalId),
        ),
      )
      .limit(1);
    if (!approval) throw conflict();
    const checked = await options.resolveApprovals().verify(approval);
    await assertStatement(actor, facts, checked.statement, "request-approval");
    const key = digest("np.agent-runtime-approved-operator-execution.v1", {
      runId: runtime.run.id,
      requestActionId,
      approvalId: approval.id,
      statementHash: approval.statementHash,
    });
    const operation = facts.input;
    const input = {
      planId: plan.id,
      planDigest: plan.artifactDigest,
      approvalId: approval.id,
      ...(operation.action === "cache.revalidate"
        ? { action: operation.action, target: operation.target }
        : operation.action === "agent.run.retry"
          ? { action: operation.action, failedRunId: operation.target.runId }
          : { action: operation.action, runId: operation.target.runId }),
    };
    const request = npRequireAgentOperatorCapabilityInvocationRequestV1({
      schemaVersion: "np.agent-invocation-request.v1",
      capabilityId: "ops.execute",
      arguments: { idempotencyKey: key, input },
    });
    const [execution] = await runtime.db
      .select()
      .from(npAgentOperatorExecutions)
      .where(
        and(
          eq(npAgentOperatorExecutions.siteId, runtime.siteId),
          eq(npAgentOperatorExecutions.planId, plan.id),
        ),
      )
      .limit(1);
    if (execution) {
      const [action] = await runtime.db
        .select()
        .from(npAgentActions)
        .where(
          and(
            eq(npAgentActions.siteId, runtime.siteId),
            eq(npAgentActions.runId, runtime.run.id),
            eq(npAgentActions.invocationId, execution.invocationId),
          ),
        )
        .limit(1);
      if (
        !action ||
        action.idempotencyKey !== key ||
        !same(action.inputCanonical, input) ||
        approval.state !== "consumed"
      )
        throw conflict();
      if (execution.state === "succeeded") {
        const [invocation] = await runtime.db
          .select()
          .from(npAgentInvocations)
          .where(
            and(
              eq(npAgentInvocations.siteId, runtime.siteId),
              eq(npAgentInvocations.id, execution.invocationId),
            ),
          )
          .limit(1);
        if (
          !invocation ||
          invocation.runId !== runtime.run.id ||
          invocation.resultId !== action.id ||
          action.state !== "succeeded" ||
          action.runFingerprint !== runtime.run.admissionFingerprint ||
          action.invocationFingerprint !== invocation.requestHash ||
          action.outputHash !== invocation.outputHash ||
          !same(action.outputRedacted, invocation.outputRedacted) ||
          !same(execution.resultCanonical, invocation.outputRedacted)
        )
          throw conflict();
        const parsed = npRequireAgentOperatorCapabilityInputV1(
          "ops.execute",
          invocation.requestBody.input,
        );
        const result = await replay(
          actor,
          invocation,
          "ops.execute",
          parsed,
          invocation.requestHash,
        );
        const output = npRequireAgentOperatorCapabilityOutputV1("ops.execute", result.output);
        if (
          output.planId !== plan.id ||
          output.action !== facts.input.action ||
          output.state !== "succeeded" ||
          output.resultDigest !== execution.resultDigest ||
          digest("np.agent-operator-execution-result.v1", {
            planId: output.planId,
            action: output.action,
            state: output.state,
            evidence: execution.evidenceCanonical,
            verificationRefs: output.verificationRefs,
          }) !== output.resultDigest
        )
          throw conflict();
        const canonical = npRequireAgentActionCanonical({
          schemaVersion: "np.agent-action.v1",
          siteId: action.siteId,
          actionId: action.id,
          invocationFingerprint: action.invocationFingerprint,
          runFingerprint: action.runFingerprint,
          sequence: action.sequence,
          capabilityId: action.capabilityId,
          capabilityContractVersion: action.capabilityContractVersion,
          capabilityFingerprint: action.capabilityFingerprint,
          effectProfile: {
            id: action.effectProfileId,
            contractVersion: action.effectContractVersion,
          },
          risk: action.risk,
          requiredScopes: action.requiredScopes,
          targetRefs: action.targetRefs,
          targetVersionFacts: action.targetVersionFacts,
          input: action.inputCanonical,
        });
        if (
          (await npDigestAgentActionCanonical(canonical)) !== action.inputHash ||
          !same(action.capabilityDefinitionBody, invocation.capabilityDefinitionBody) ||
          action.capabilityFingerprint !== invocation.contractFingerprint
        )
          throw conflict();
      }
      return {
        status: execution.state === "succeeded" ? ("completed" as const) : ("unresolved" as const),
        requestActionId,
        executionActionId: action.id,
        executionSequence: action.sequence,
        request,
      };
    }
    if (approval.expiresAt <= runtime.now || !["pending", "approved"].includes(approval.state))
      throw conflict();
    if (approval.state === "approved") {
      if (!approval.decidedByUserId) throw conflict();
      await liveApprover(runtime.db, facts, approval.decidedByUserId);
    }
    return {
      status: approval.state === "approved" ? ("ready" as const) : ("pending" as const),
      requestActionId,
      executionActionId: null,
      executionSequence: null,
      request,
    };
  }
  async function inspectRuntimeApproval(
    runtime: NpAgentRuntimeRunContextV1,
    requestActionId: string,
  ): Promise<NpAgentRuntimeApprovalInspectionV1> {
    const { request: _request, ...receipt } = await runtimeApprovalEvidence(
      runtime,
      requestActionId,
    );
    return receipt;
  }
  async function resumeRuntimeApproval(input: {
    siteId: string;
    runId: string;
    claim: NpAgentRuntimeExecutionClaimV1;
    sequence: number;
    requestActionId: string;
  }) {
    if (!options.runtimeAdmission) throw unavailable();
    const evidence = await options.runtimeAdmission.withCurrentRun(
      { siteId: input.siteId, runId: input.runId, claim: input.claim },
      (runtime) => runtimeApprovalEvidence(runtime, input.requestActionId),
    );
    if (
      evidence.status === "pending" ||
      (evidence.executionSequence !== null && evidence.executionSequence !== input.sequence)
    )
      throw conflict();
    return invokeRuntimeRequest({
      siteId: input.siteId,
      runId: input.runId,
      claim: input.claim,
      sequence: input.sequence,
      request: evidence.request,
    });
  }

  async function invokeRuntimeRequest(input: {
    siteId: string;
    runId: string;
    claim?: NpAgentRuntimeExecutionClaimV1;
    sequence: number;
    request: NpAgentOperatorCapabilityInvocationRequestV1;
  }) {
    npAssertAgentPreviewEffectsAllowed();
    const admission = options.runtimeAdmission;
    if (!admission) throw unavailable();
    const result = await withCurrentSite(input.siteId, () =>
      withDeferredPostCommit(() =>
        admission.withCurrentRun(
          {
            siteId: input.siteId,
            runId: input.runId,
            ...(input.claim ? { claim: input.claim } : {}),
          },
          async (runtime) => request(await runtimeActor(runtime, input.sequence), input.request),
        ),
      ),
    );
    return "pendingExecutionId" in result ? finishExecution(result) : result;
  }

  return {
    approvalTargets,
    inspectRuntimeApproval,
    resumeRuntimeApproval,
    capabilityIds,
    async invokeCapability(input: {
      authentication: NpAgentCapabilityAuthenticationV1;
      request: NpAgentOperatorCapabilityInvocationRequestV1;
      taskRequest?: NpAgentMcpTaskRequestV1;
    }) {
      npAssertAgentPreviewEffectsAllowed();
      const { authentication } = input;
      const entry = await definition(input.request.capabilityId);
      const result = await withCurrentSite(authentication.principal.siteId, () =>
        withDeferredPostCommit(() =>
          options.admission.withCurrentAuthority({
            authentication,
            prepareTransaction: (db) =>
              npWithAgentRuntimeControlTransactionV1(
                authentication.principal.siteId,
                () => Promise.resolve(undefined),
                db,
              ),
            requiredScopes: entry.descriptor.requiredScopes,
            minimumExposure:
              input.request.capabilityId === "ops.execute"
                ? "approved-execute"
                : input.request.capabilityId === "ops.plan"
                  ? "propose"
                  : "read",
            mutate: (db, time) =>
              request(
                {
                  db,
                  time,
                  authentication,
                  sequence: 1,
                  principal: principal(authentication),
                  authorizationContext: authentication.authorizationContext,
                  authorizationContextFingerprint: authentication.authorizationContextFingerprint,
                },
                input.request,
                input.taskRequest,
              ),
          }),
        ),
      );
      return "pendingExecutionId" in result ? finishExecution(result) : result;
    },
    invokeRuntimeCapability: invokeRuntimeRequest,
    async projectRuntimeAction(runtime: NpAgentRuntimeRunContextV1, actionId: string) {
      const [action] = await runtime.db
        .select()
        .from(npAgentActions)
        .where(
          and(
            eq(npAgentActions.siteId, runtime.siteId),
            eq(npAgentActions.runId, runtime.run.id),
            eq(npAgentActions.id, actionId),
          ),
        )
        .limit(1);
      if (
        !action ||
        !capabilityIds.includes(action.capabilityId as NpAgentOperatorCapabilityIdV1) ||
        !action.invocationId ||
        action.runFingerprint !== runtime.run.admissionFingerprint ||
        action.state !== "succeeded"
      )
        return null;
      const [row] = await runtime.db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, runtime.siteId),
            eq(npAgentInvocations.id, action.invocationId),
          ),
        )
        .limit(1);
      const actor = await runtimeActor(runtime, action.sequence);
      if (
        !row ||
        row.resultId !== action.id ||
        row.authorizationContextFingerprint !== actor.authorizationContextFingerprint ||
        action.outputHash !== row.outputHash ||
        serializeAgentCanonicalJson(action.outputRedacted) !==
          serializeAgentCanonicalJson(row.outputRedacted)
      )
        throw conflict();
      const actionCanonical = npRequireAgentActionCanonical({
        schemaVersion: "np.agent-action.v1",
        siteId: action.siteId,
        actionId: action.id,
        invocationFingerprint: action.invocationFingerprint,
        runFingerprint: action.runFingerprint,
        sequence: action.sequence,
        capabilityId: action.capabilityId,
        capabilityContractVersion: action.capabilityContractVersion,
        capabilityFingerprint: action.capabilityFingerprint,
        effectProfile: {
          id: action.effectProfileId,
          contractVersion: action.effectContractVersion,
        },
        risk: action.risk,
        requiredScopes: action.requiredScopes,
        targetRefs: action.targetRefs,
        targetVersionFacts: action.targetVersionFacts,
        input: action.inputCanonical,
      });
      const def = await definition(action.capabilityId as NpAgentOperatorCapabilityIdV1);
      if (
        (await npDigestAgentActionCanonical(actionCanonical)) !== action.inputHash ||
        action.invocationFingerprint !== row.requestHash ||
        action.capabilityFingerprint !== def.fingerprint ||
        row.contractFingerprint !== def.fingerprint ||
        serializeAgentCanonicalJson(action.capabilityDefinitionBody) !==
          serializeAgentCanonicalJson(def.canonical) ||
        action.idempotencyKey !== row.idempotencyKey ||
        serializeAgentCanonicalJson(action.inputCanonical) !==
          serializeAgentCanonicalJson(row.requestBody.input)
      )
        throw conflict();
      const id = action.capabilityId as NpAgentOperatorCapabilityIdV1;
      const parsed = npRequireAgentOperatorCapabilityInputV1(id, action.inputCanonical);
      const result = await replay(actor, row, id, parsed, row.requestHash);
      if (id === "audit.run" && "state" in result.output && result.output.state !== "completed")
        throw conflict();
      return {
        capabilityId: id,
        state: "succeeded" as const,
        safeCode: null,
        operatorOutput: result.output,
      };
    },
    processAudit,
    refreshInvocation,
    /** Explicit recovery resumes the admitted record through the same worker owner. */
    async recoverAudit(job: NpAgentOperatorAuditJobV1) {
      parseJob(job);
      await processAudit(job);
    },
    registerJobHandlers() {
      registerJobHandler("agent:operatorAudit", processAudit, {
        parsePayload: parseJob,
        resolveSiteId: (data) => data.siteId,
        quota: "site",
      });
    },
  };
}
export type NpAgentOperatorServiceV1 = ReturnType<typeof createAgentOperatorServiceV1>;
