import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentInvocations,
  npAgentOperatorPlans,
  npAgentOperatorExecutions,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  npRequireAgentActionCanonical,
  npDigestAgentActionCanonical,
} from "../agent-contract/canonical-action.js";
import {
  npRequireAgentInvocationRequestCanonical,
  npDigestAgentInvocationRequestCanonical,
} from "../agent-contract/canonical-idempotency-request.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentOpsPlanOutputV1,
  npRequireAgentOpsStatusOutputV1,
  npRequireAgentAuditRunOutputV1,
  npRequireAgentOpsExecuteOutputV1,
  npRequireAgentOpsStatusInputV1,
  npRequireAgentOperatorCapabilityInputV1,
} from "../agent-contract/operator-capability-contract.js";
import { npRequireAgentOperatorMonitorSnapshotV1 } from "../agent-contract/operator-monitor-contract.js";
import {
  npRequireAgentOperatorReviewV1,
  type NpAgentOperatorReviewV1,
} from "../agent-contract/operator-review-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npRequireAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";

type Db = ReturnType<typeof getDb>;
const digest = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(domain + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
const fail = (): never => {
  throw new NpAgentGatewayError("ACTIVITY_NOT_FOUND", 404, "Operator evidence is unavailable.");
};
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);

/** Reads retained evidence only. The caller owns current staff/target authorization around this read. */
export async function npReadAgentOperatorReviewV1(input: {
  db: Db;
  siteId: string;
  actionId: string;
  now: Date;
  authorize: (selector: {
    capabilityId: NpAgentOperatorReviewV1["capabilityId"];
    input: unknown;
  }) => Promise<void>;
}): Promise<NpAgentOperatorReviewV1> {
  const { db, siteId } = input;
  const [a] = await db
    .select()
    .from(npAgentActions)
    .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, input.actionId)))
    .limit(1);
  if (
    !a?.invocationId ||
    !["ops.status", "audit.run", "ops.plan", "ops.execute"].includes(a.capabilityId)
  )
    return fail();
  const [i] = await db
    .select()
    .from(npAgentInvocations)
    .where(and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, a.invocationId)))
    .limit(1);
  if (
    !i ||
    i.resultId !== a.id ||
    i.operationId !== a.capabilityId ||
    i.state !== "completed" ||
    ![
      "succeeded",
      "compensated",
      ...(a.capabilityId === "ops.plan" ? ["approval_pending", "approved"] : []),
    ].includes(a.state) ||
    !a.outputRedacted ||
    !same(i.outputRedacted, a.outputRedacted) ||
    i.outputHash !== a.outputHash ||
    i.requestHash !== a.invocationFingerprint ||
    i.contractFingerprint !== a.capabilityFingerprint ||
    !same(i.capabilityDefinitionBody, a.capabilityDefinitionBody) ||
    !same(i.requestBody.input, a.inputCanonical) ||
    (await npDigestAgentInvocationRequestCanonical(
      npRequireAgentInvocationRequestCanonical(i.requestBody),
    )) !== i.requestHash ||
    digest("np.agent-capability-output.v1", a.outputRedacted) !== a.outputHash
  )
    return fail();
  const canonical = npRequireAgentActionCanonical({
    schemaVersion: "np.agent-action.v1",
    siteId,
    actionId: a.id,
    invocationFingerprint: a.invocationFingerprint,
    runFingerprint: a.runFingerprint,
    sequence: a.sequence,
    capabilityId: a.capabilityId,
    capabilityContractVersion: a.capabilityContractVersion,
    capabilityFingerprint: a.capabilityFingerprint,
    effectProfile: { id: a.effectProfileId, contractVersion: a.effectContractVersion },
    risk: a.risk,
    requiredScopes: a.requiredScopes,
    targetRefs: a.targetRefs,
    targetVersionFacts: a.targetVersionFacts,
    input: a.inputCanonical,
  });
  if ((await npDigestAgentActionCanonical(canonical)) !== a.inputHash) return fail();
  const definition = npRequireAgentCapabilityRegistryCanonical(i.capabilityDefinitionBody);
  if (
    (await npDigestAgentCapabilityRegistryCanonical(definition, definition.capabilities)) !==
    a.capabilityFingerprint
  )
    return fail();
  const capabilityId = a.capabilityId as NpAgentOperatorReviewV1["capabilityId"];
  const selector = {
    capabilityId,
    input:
      capabilityId === "ops.status"
        ? npRequireAgentOpsStatusInputV1(a.inputCanonical)
        : npRequireAgentOperatorCapabilityInputV1(capabilityId, a.inputCanonical),
  };
  await input.authorize(selector);
  const review: NpAgentOperatorReviewV1 = {
    schemaVersion: "np.agent-operator-review.v1",
    capabilityId,
    checks: [],
    plan: null,
    queue: null,
    recovery: null,
    execution: null,
  };
  if (capabilityId === "ops.status")
    review.checks = npRequireAgentOpsStatusOutputV1(a.outputRedacted).report.checks.map((c) => ({
      id: c.id,
      state: c.state === "ok" ? "pass" : c.state === "error" ? "fail" : "warn",
    }));
  if (capabilityId === "audit.run") {
    const report = npRequireAgentAuditRunOutputV1(a.outputRedacted);
    if (report.state !== "completed") return fail();
    review.checks = report.checks.map((c) => ({ id: c.id, state: c.status }));
  }
  if (capabilityId === "ops.execute") {
    const out = npRequireAgentOpsExecuteOutputV1(a.outputRedacted);
    const [execution] = await db
      .select()
      .from(npAgentOperatorExecutions)
      .where(
        and(
          eq(npAgentOperatorExecutions.siteId, siteId),
          eq(npAgentOperatorExecutions.invocationId, i.id),
        ),
      )
      .limit(1);
    if (
      !execution ||
      execution.planId !== out.planId ||
      !same(execution.resultCanonical, out) ||
      execution.resultDigest !== out.resultDigest ||
      digest("np.agent-operator-execution-result.v1", {
        planId: out.planId,
        action: out.action,
        state: out.state,
        evidence: execution.evidenceCanonical,
        verificationRefs: out.verificationRefs,
      }) !== out.resultDigest
    )
      return fail();
    review.execution = { state: out.state, resultDigest: out.resultDigest };
  }
  if (capabilityId === "ops.plan") {
    const out = npRequireAgentOpsPlanOutputV1(a.outputRedacted);
    const [plan] = await db
      .select()
      .from(npAgentOperatorPlans)
      .where(and(eq(npAgentOperatorPlans.siteId, siteId), eq(npAgentOperatorPlans.id, out.planId)))
      .limit(1);
    if (
      !plan ||
      plan.invocationId !== i.id ||
      plan.auditEventId !== i.auditEventId ||
      !same(plan.operation, out.operation) ||
      plan.artifactDigest !== out.planDigest ||
      plan.expiresAt.toISOString() !== out.expiresAt ||
      digest("np.agent-operator-plan-artifact.v1", {
        operation: plan.operation,
        contractId: plan.contractId,
        artifact: plan.artifactCanonical,
      }) !== out.planDigest
    )
      return fail();
    review.plan = out;
    if (out.execution.kind === "local-cli-handoff") {
      if (out.execution.contractId !== plan.contractId || out.execution.planArtifactId !== plan.id)
        return fail();
      // Only fixed shipped planning commands are displayable; custom owner commands remain private.
      const command =
        plan.contractId === "runbook" && plan.artifactCanonical.runbook === "worker-not-draining"
          ? "pnpm --silent run ops:runbook -- worker-not-draining --json"
          : plan.contractId === "ops.backup" &&
              out.operation.action === "restore.plan" &&
              /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(out.operation.target.manifestId)
            ? `pnpm --silent run ops:backup -- restore-plan ${out.operation.target.manifestId} --json`
            : "Local planning command unavailable; consult the installed host owner.";
      review.plan = npRequireAgentOpsPlanOutputV1({
        ...out,
        execution: { ...out.execution, projectCommand: command },
      });
    }
    review.checks = out.checks.map((c) => ({ id: c.id, state: c.status }));
    if (
      plan.contractId === "runbook" &&
      plan.artifactCanonical.runbook === "worker-not-draining" &&
      plan.artifactCanonical.observation
    ) {
      const snapshot = npRequireAgentOperatorMonitorSnapshotV1(
        plan.artifactCanonical.observation as unknown as Parameters<
          typeof npRequireAgentOperatorMonitorSnapshotV1
        >[0],
      );
      const queues = snapshot.queues.filter(
        (q) =>
          out.operation.action === "queue.global.plan" &&
          (out.operation.target.jobName === null || q.name === out.operation.target.jobName),
      );
      if (!queues.length) return fail();
      review.queue = {
        observedAt: snapshot.observedAt,
        paused: snapshot.paused,
        ready: queues.reduce((n, q) => n + q.ready, 0),
        active: queues.reduce((n, q) => n + q.active, 0),
      };
    }
    const [monitor] = await db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.siteId, siteId),
          eq(npAuditEvents.targetType, "agent-operator-monitor"),
          eq(npAuditEvents.targetId, plan.id),
        ),
      )
      .orderBy(
        desc(sql`(${npAuditEvents.payload}->>'revision')::integer`),
        desc(npAuditEvents.createdAt),
        desc(npAuditEvents.id),
      )
      .limit(1);
    if (monitor) {
      const { bodyHash, ...body } = monitor.payload;
      if (
        body.schemaVersion !== "np.agent-operator-recovery.v1" ||
        body.monitorId !== plan.id ||
        body.planId !== plan.id ||
        body.planDigest !== plan.artifactDigest ||
        bodyHash !== createHash("sha256").update(serializeAgentCanonicalJson(body)).digest("hex")
      )
        return fail();
      npRequireAgentOperatorMonitorSnapshotV1(
        body.before as Parameters<typeof npRequireAgentOperatorMonitorSnapshotV1>[0],
      );
      npRequireAgentOperatorMonitorSnapshotV1(
        body.after as Parameters<typeof npRequireAgentOperatorMonitorSnapshotV1>[0],
      );
      review.recovery = {
        monitorId: plan.id,
        startedAt: body.startedAt,
        sampledAt: body.sampledAt,
        deadline: body.deadline,
        ...(body.assessment as object),
      } as NpAgentOperatorReviewV1["recovery"];
    }
  }
  await input.authorize(selector);
  return npRequireAgentOperatorReviewV1(review);
}
