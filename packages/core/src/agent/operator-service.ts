import type { NpAgentJsonObject } from "../agent-contract/types.js";
import type {
  NpAgentAuditRunInputV1,
  NpAgentAuditRunOutputV1,
  NpAgentOpsPlanInputV1,
  NpAgentOpsPlanOutputV1,
} from "../agent-contract/operator-capability-contract.js";
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
/** Explicit installation only. Adapters read actual owners without mutating operational
 * state, honor abortSignal, and return redacted evidence. No provider/network activation. */
export interface NpAgentOperatorHostV1 {
  assertAccess(
    input: NpAgentOperatorHostContextV1 & {
      capabilityId: "audit.run" | "ops.plan";
      input: NpAgentAuditRunInputV1 | NpAgentOpsPlanInputV1;
    },
  ): Promise<void>;
  audit?(
    input: NpAgentOperatorHostContextV1 & {
      input: NpAgentAuditRunInputV1;
      auditId: string;
    },
  ): Promise<{ checks: NpAgentAuditRunOutputV1["checks"] }>;
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
  npAgentActions,
  npAgentInvocations,
  npAgentMcpTasks,
  npAgentOperatorPlans,
} from "../db/schema/agent.js";
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
type CommandInput = NpAgentAuditRunInputV1 | NpAgentOpsPlanInputV1;
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
      ["cache.revalidate", "agent.run.retry", "agent.run.cancel"].includes(input.action)
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
      output.execution.kind !== "local-cli-handoff" ||
      output.execution.planArtifactId !== plan.id ||
      output.execution.contractId !== plan.contractId ||
      serializeAgentCanonicalJson(plan.operation) !== serializeAgentCanonicalJson(output.operation)
    )
      throw conflict();
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
      .where(and(eq(npAgentActions.siteId, row.siteId), eq(npAgentActions.invocationId, row.id)));
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
    const expiresAt = new Date(actor.time.getTime() + 3600000);
    const output = npRequireAgentOperatorCapabilityOutputV1("ops.plan", {
      schemaVersion: "np.agent-ops-plan.v1",
      planId,
      planDigest,
      operation: input,
      checks: artifact.checks,
      expiresAt: expiresAt.toISOString(),
      execution: {
        kind: "local-cli-handoff",
        contractId: artifact.contractId,
        planArtifactId: planId,
        projectCommand: artifact.projectCommand,
      },
    });
    await actor.db.insert(npAgentOperatorPlans).values({
      id: planId,
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
    return output;
  }
  async function request(
    actor: ActorContext,
    req: NpAgentOperatorCapabilityInvocationRequestV1,
    taskRequest?: NpAgentMcpTaskRequestV1,
  ): Promise<NpAgentOperatorCapabilityInvocationResultV1 & { task?: NpAgentMcpTaskV1 }> {
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
      effectProfile: { id: "domain.read", contractVersion: 1 },
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
        effectProfile: { id: "domain.read", contractVersion: 1 },
        risk: "read",
        requiredScopes,
        targetRefs: [],
        targetVersionFacts: [],
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
          effectProfileId: "domain.read",
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
        effectProfileId: "domain.read",
        effectContractVersion: 1,
        risk: "read",
        state: "executing",
        idempotencyKey: key,
        inputRedacted: json(parsed),
        inputCanonical: json(parsed),
        requiredScopes,
        targetRefs: [],
        targetVersionFacts: [],
        inputHash: await npDigestAgentActionCanonical(action),
        auditEventId: auditId,
        startedAt: actor.time,
        createdAt: actor.time,
      });
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
  return {
    capabilityIds,
    async invokeCapability(input: {
      authentication: NpAgentCapabilityAuthenticationV1;
      request: NpAgentOperatorCapabilityInvocationRequestV1;
      taskRequest?: NpAgentMcpTaskRequestV1;
    }) {
      npAssertAgentPreviewEffectsAllowed();
      const { authentication } = input;
      const entry = await definition(input.request.capabilityId);
      return withCurrentSite(authentication.principal.siteId, () =>
        withDeferredPostCommit(() =>
          options.admission.withCurrentAuthority({
            authentication,
            requiredScopes: entry.descriptor.requiredScopes,
            minimumExposure: input.request.capabilityId === "ops.plan" ? "propose" : "read",
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
    },
    async invokeRuntimeCapability(input: {
      siteId: string;
      runId: string;
      claim?: NpAgentRuntimeExecutionClaimV1;
      sequence: number;
      request: NpAgentOperatorCapabilityInvocationRequestV1;
    }) {
      npAssertAgentPreviewEffectsAllowed();
      const admission = options.runtimeAdmission;
      if (!admission) throw unavailable();
      return withCurrentSite(input.siteId, () =>
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
    },
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
      if ("state" in result.output && result.output.state !== "completed") throw conflict();
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
