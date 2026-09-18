import { npReadCancelledChangeSetLifecycleV1 } from "./cancelled-changeset-lifecycle.js";
import { npVerifyAgentReleaseStudioAttributionV1 } from "./studio-source-release.js";
import { npRequireAgentRuntimeRetainedCallV1 } from "./runtime-usage.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentChangesets,
  npAgentInvocations,
  npAgentRuns,
  npAgentProviderCalls,
  npAgentUsageReservations,
  npAgentCircuitBreakers,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  npRequireAgentSourceReleaseV1,
  npDigestAgentSourceReleaseV1,
  npDigestAgentRuntimeAdmissionKeyV1,
  type NpAgentSourceReleaseCanonicalV1,
} from "../agent-contract/source-release-contract.js";
import { npRequireAgentRuntimeExecutionIntegrityV1 } from "./runtime-execution-store.js";
import { npRuntimeRunAdmissionBodyV1 } from "./runtime-admission.js";
import {
  npRequireAgentRuntimeProviderDecisionV1,
  npRequireAgentRuntimeProviderFailureV1,
} from "./runtime-provider-evidence.js";
import { npAgentSiteOwnedTableNamesV1 } from "./site-deletion.js";
import {
  npRequireAgentSourceReleaseRecordV1,
  npSourceReleaseOwnerDigestV1,
  npVerifyAgentReleaseReadAttributionV1,
} from "./source-release-read.js";
import { npAgentReferenceFenceCoverageSqlV1 } from "./reference-fence-sql.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { NpAgentContractError } from "../agent-contract/contract.js";

type Db = ReturnType<typeof getDb>;
type Body = NpAgentSourceReleaseCanonicalV1;
type Kind = Body["kind"];
type Reservation = typeof npAgentUsageReservations.$inferSelect;
type Edge = typeof npAgentSourceReleaseEdges.$inferInsert;
type Action = typeof npAgentActions.$inferSelect;
const MAX_REFERENCES = 100;
// Accommodate the 16 MiB capability registry plus 4 MiB Action/request bodies.
// Larger retained evidence remains valid history but is not loaded by cleanup.
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;
const MAX_REFERENCE_BATCH_BYTES = 64 * 1024 * 1024;
const guards = [...npAgentSiteOwnedTableNamesV1, "np_agent_site_deletion_sagas", "np_audit_events"];
const tables = {
  "runtime-run": "np_agent_runs",
  "provider-call": "np_agent_provider_calls",
  "usage-reservation": "np_agent_usage_reservations",
  "circuit-breaker": "np_agent_circuit_breakers",
} as const;
const terminalStates = [
  "queued",
  "running",
  "waiting_retry",
  "waiting_approval",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
  "policy_blocked",
  "budget_blocked",
];

function invalid(): never {
  throw new NpAgentGatewayError("RUNTIME_RELEASE_INVALID", 409, "Agent history is unavailable.");
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(row: unknown, required: string[], optional: string[] = []): boolean {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return false;
  return (
    required.every((k) => Object.hasOwn(row, k)) &&
    Object.keys(row).every((k) => required.includes(k) || optional.includes(k))
  );
}
function contains(value: unknown, id: string): boolean {
  return JSON.stringify(value).includes(id);
}

/** Must precede source/owner row locks. NOWAIT avoids a site-lock inversion. */
export async function npLockAgentSourceReleaseFenceV1(
  db: Db,
  beforeStatement: () => Promise<void>,
): Promise<void> {
  await beforeStatement();
  const locked = await db.execute(
    sql`select epoch from np_agent_reference_fence where id=1 for update nowait`,
  );
  if (locked.rows.length !== 1 || BigInt(String(locked.rows[0].epoch)) < 0n) invalid();
  await beforeStatement();
  const jobs = await db.execute(sql`select to_regclass('pgboss.job') is not null as present`);
  // SHARE conflicts with partition attachment and journal writers. No initialization.
  if (jobs.rows[0]?.present === true) {
    await beforeStatement();
    await db.execute(sql`lock table pgboss.job in share mode nowait`);
  }
  await beforeStatement();
  const coverage = await db.execute(sql.raw(npAgentReferenceFenceCoverageSqlV1(guards)));
  if (coverage.rows[0]?.missing_count !== "0") invalid();
  await beforeStatement();
  await db.execute(sql`update np_agent_reference_fence set epoch=epoch+1 where id=1`);
}

function reservationFacts(r: Reservation) {
  if (!r.finalizedAt || r.unpriced) invalid();
  return {
    runId: r.runId,
    agentId: r.agentId,
    connectionId: r.connectionId,
    model: r.model,
    pricingId: r.pricingId,
    pricingVersion: r.pricingVersion,
    pricingFingerprint: r.pricingFingerprint,
    pricingEffectiveAt: r.pricingEffectiveAt.toISOString(),
    reservedAt: r.reservedAt.toISOString(),
    finalizedAt: r.finalizedAt.toISOString(),
    state: r.state,
    reservedCalls: r.reservedCalls,
    reservedInputTokens: r.reservedInputTokens,
    reservedOutputTokens: r.reservedOutputTokens,
    reservedCostMicros: r.reservedCostMicros,
    actualInputTokens: r.actualInputTokens,
    actualCachedInputTokens: r.actualCachedInputTokens,
    actualOutputTokens: r.actualOutputTokens,
    actualCostMicros: r.actualCostMicros,
    actualUsageSource: r.actualUsageSource,
    actualCostSource: r.actualCostSource,
    budgetChargeCostMicros: r.budgetChargeCostMicros,
  };
}
function reservationFingerprint(r: Reservation): string {
  return npSourceReleaseOwnerDigestV1({ siteId: r.siteId, id: r.id, ...reservationFacts(r) });
}
async function parent(db: Db, siteId: string, id: string) {
  const [run] = await db
    .select()
    .from(npAgentRuns)
    .where(and(eq(npAgentRuns.siteId, siteId), eq(npAgentRuns.id, id)))
    .for("update", { noWait: true });
  if (!run) return invalid();
  await npRequireAgentRuntimeExecutionIntegrityV1(run);
  return run;
}

async function evidence(input: {
  db: Db;
  siteId: string;
  id: string;
  kind: Kind;
  now: Date;
  retentionEligibleAt?: Date;
}) {
  const { db, siteId, id, kind, now } = input;
  const common = {
    schemaVersion: "np.agent-source-release.v1",
    verifierVersion: 1,
    kind,
    siteId,
    sourceId: id,
    releasedAt: now.toISOString(),
  };
  if (kind === "runtime-run") {
    const run = await parent(db, siteId, id);
    if (!run.agentId || !run.agentVersionId || !run.finishedAt || !input.retentionEligibleAt)
      invalid();
    return {
      body: npRequireAgentSourceReleaseV1({
        ...common,
        principalId: run.principalId,
        agentId: run.agentId,
        agentVersionId: run.agentVersionId,
        admissionFingerprint: run.admissionFingerprint,
        runLimitsHash: run.runLimitsHash,
        budgetSnapshotHash: run.budgetSnapshotHash,
        state: run.state,
        finishedAt: run.finishedAt.toISOString(),
        deadlineAt: run.deadlineAt.toISOString(),
        retentionEligibleAt: input.retentionEligibleAt.toISOString(),
        admissionKeyDigest: await npDigestAgentRuntimeAdmissionKeyV1({
          siteId,
          principalId: run.principalId,
          idempotencyKey: run.idempotencyKey,
        }),
      }),
      run,
      reservation: null,
    };
  }
  if (kind === "provider-call") {
    const [call] = await db
      .select()
      .from(npAgentProviderCalls)
      .where(and(eq(npAgentProviderCalls.siteId, siteId), eq(npAgentProviderCalls.id, id)))
      .for("update", { noWait: true });
    if (!call || !call.finishedAt) return invalid();
    const retained = await npRequireAgentRuntimeRetainedCallV1({ db, call, noWait: true });
    const run = retained.run,
      r = retained.reservation;
    await npRequireAgentRuntimeExecutionIntegrityV1(run);
    if (call.state === "succeeded") await npRequireAgentRuntimeProviderDecisionV1(call);
    else await npRequireAgentRuntimeProviderFailureV1({ db, call });
    if (!r.finalizedAt || r.unpriced) return invalid();
    npRequireAgentSourceReleaseV1({
      ...common,
      kind: "usage-reservation",
      sourceId: r.id,
      ...reservationFacts(r),
    });
    if (
      call.dispatchState === "dispatched" &&
      (r.state !== "reconciled" ||
        r.actualInputTokens !== call.inputTokens ||
        r.actualCachedInputTokens !== call.cachedInputTokens ||
        r.actualOutputTokens !== call.outputTokens ||
        r.actualCostMicros !== call.costMicros ||
        r.actualUsageSource !== call.usageSource ||
        r.actualCostSource !== call.costSource)
    )
      invalid();
    if (call.dispatchState === "not-dispatched" && r.state !== "released") invalid();
    return {
      body: npRequireAgentSourceReleaseV1({
        ...common,
        runId: call.runId,
        runFingerprint: run.admissionFingerprint,
        reservationId: r.id,
        reservationFingerprint: reservationFingerprint(r),
        requestDigest: call.requestDigest,
        responseDigest: call.responseDigest,
        state: call.state,
        dispatchState: call.dispatchState,
        usageSource: call.usageSource,
        costSource: call.costSource,
        inputTokens: call.inputTokens,
        cachedInputTokens: call.cachedInputTokens,
        outputTokens: call.outputTokens,
        costMicros: call.costMicros,
        finishedAt: call.finishedAt.toISOString(),
        reservationFinalizedAt: r.finalizedAt.toISOString(),
      }),
      run,
      reservation: r,
    };
  }
  if (kind === "usage-reservation") {
    const [r] = await db
      .select()
      .from(npAgentUsageReservations)
      .where(and(eq(npAgentUsageReservations.siteId, siteId), eq(npAgentUsageReservations.id, id)))
      .for("update", { noWait: true });
    if (!r) return invalid();
    const run = await parent(db, siteId, r.runId);
    // A deleted Call must have handed off its exact verified reservation facts,
    // even if a legacy database has lost all of its normal audit references.
    const callReceipts = await db
      .select()
      .from(npAgentSourceReleases)
      .where(
        and(
          eq(npAgentSourceReleases.siteId, siteId),
          eq(npAgentSourceReleases.sourceKind, "provider-call"),
          sql`${npAgentSourceReleases.evidenceBody}->>'reservationId'=${id}`,
        ),
      )
      .limit(2);
    if (callReceipts.length !== 1) return invalid();
    const callReceipt = await npRequireAgentSourceReleaseRecordV1(callReceipts[0]);
    if (
      callReceipt.kind !== "provider-call" ||
      callReceipt.runId !== r.runId ||
      callReceipt.runFingerprint !== run.admissionFingerprint ||
      callReceipt.reservationFingerprint !== reservationFingerprint(r)
    )
      return invalid();
    return {
      body: npRequireAgentSourceReleaseV1({ ...common, ...reservationFacts(r) }),
      run,
      reservation: r,
    };
  }
  const [b] = await db
    .select()
    .from(npAgentCircuitBreakers)
    .where(and(eq(npAgentCircuitBreakers.siteId, siteId), eq(npAgentCircuitBreakers.id, id)))
    .for("update", { noWait: true });
  if (!b) return invalid();
  return {
    body: npRequireAgentSourceReleaseV1({
      ...common,
      scopeKind: b.scopeKind,
      scopeRef: b.scopeRef,
      version: b.versionNumber,
      state: b.state,
      failureCount: b.failureCount,
      probeLeaseUntil: b.probeLeaseUntil,
      updatedAt: b.updatedAt.toISOString(),
    }),
    run: null,
    reservation: null,
  };
}

type Evidence = Awaited<ReturnType<typeof evidence>>;
async function auditEdges(
  db: Db,
  row: typeof npAuditEvents.$inferSelect,
  e: Evidence,
): Promise<string[] | null> {
  const b = e.body;
  if (
    row.siteId !== b.siteId ||
    row.actorKind !== "system" ||
    row.createdAt > new Date(b.releasedAt)
  )
    return null;
  const p = row.payload;
  const target = row.targetId === b.sourceId;
  const codes: string[] = [];
  if (b.kind === "runtime-run" && target && row.targetType === "agent-run") {
    if (
      row.action === "agent.runtime.admitted" &&
      exact(p, ["runId", "actorFingerprint", "admissionFingerprint"]) &&
      p.runId === b.sourceId &&
      p.admissionFingerprint === b.admissionFingerprint &&
      e.run &&
      p.actorFingerprint ===
        npRuntimeRunAdmissionBodyV1(e.run).runtimeAuthority?.deploymentAuthorityFingerprint
    )
      codes.push("audit-target", "audit-run");
    if (
      row.action === "agent.runtime.job_admitted" &&
      exact(p, []) &&
      e.run &&
      row.createdAt >= e.run.queuedAt
    )
      codes.push("audit-target");
    if (
      row.action === "agent.runtime.execution" &&
      exact(p, ["fromState", "state", "attempt"]) &&
      typeof p.fromState === "string" &&
      terminalStates.includes(p.fromState) &&
      typeof p.state === "string" &&
      terminalStates.includes(p.state) &&
      Number.isSafeInteger(p.attempt) &&
      Number(p.attempt) > 0 &&
      e.run &&
      Number(p.attempt) <= e.run.attempt
    )
      codes.push("audit-target");
    if (
      row.action === "agent.runtime.breaker.observe-run" &&
      exact(p, ["state", "admissionFingerprint"]) &&
      p.admissionFingerprint === b.admissionFingerprint &&
      ["closed", "open", "half_open"].includes(String(p.state))
    )
      codes.push("audit-target");
  }
  if (
    (b.kind === "provider-call" || b.kind === "usage-reservation") &&
    row.targetType === "agent-provider-call"
  ) {
    let callBody: Extract<Body, { kind: "provider-call" }> | null =
      b.kind === "provider-call" ? b : null;
    if (b.kind === "usage-reservation" && row.targetId) {
      const [receipt] = await db
        .select()
        .from(npAgentSourceReleases)
        .where(
          and(
            eq(npAgentSourceReleases.siteId, b.siteId),
            eq(npAgentSourceReleases.sourceKind, "provider-call"),
            eq(npAgentSourceReleases.sourceId, row.targetId),
          ),
        )
        .limit(1);
      if (receipt) {
        const checked = await npRequireAgentSourceReleaseRecordV1(receipt);
        if (
          checked.kind === "provider-call" &&
          checked.reservationId === b.sourceId &&
          e.reservation &&
          checked.reservationFingerprint === reservationFingerprint(e.reservation)
        )
          callBody = checked;
      }
    }
    if (callBody && row.targetId === callBody.sourceId) {
      if (
        row.action === "agent.runtime.usage" &&
        exact(p, ["reservationId", "responseDigest", "transition"], ["outcomeSafeCode"]) &&
        p.reservationId === callBody.reservationId &&
        p.responseDigest === callBody.responseDigest &&
        ["reconciled", "expired-unsent"].includes(String(p.transition)) &&
        (!Object.hasOwn(p, "outcomeSafeCode") ||
          (typeof p.outcomeSafeCode === "string" &&
            /^[A-Z][A-Z0-9_]{0,63}$/u.test(p.outcomeSafeCode)))
      ) {
        codes.push(b.kind === "provider-call" ? "audit-target" : "audit-reservation");
      }
      if (
        b.kind === "provider-call" &&
        row.action === "agent.runtime.breaker.observe" &&
        exact(p, ["state", "responseDigest"]) &&
        p.responseDigest === b.responseDigest &&
        ["closed", "open", "half_open"].includes(String(p.state))
      )
        codes.push("audit-target");
    }
  }
  if (
    b.kind === "circuit-breaker" &&
    target &&
    row.targetType === "agent-circuit-breaker" &&
    row.action === "agent.runtime.breaker.probe" &&
    exact(p, ["state", "version"]) &&
    Number.isSafeInteger(p.version) &&
    Number(p.version) > 0 &&
    Number(p.version) <= b.version &&
    ["closed", "open", "half_open"].includes(String(p.state))
  )
    codes.push("audit-target");
  return codes.length ? codes : null;
}

function auditDigest(a: typeof npAuditEvents.$inferSelect): string {
  return npSourceReleaseOwnerDigestV1({
    id: a.id,
    siteId: a.siteId,
    actorKind: a.actorKind,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    payload: a.payload,
    createdAt: a.createdAt.toISOString(),
  });
}

/** All scanning and mutations occur under the already acquired global reference fence. */
export async function npPrepareAgentSourceReleaseV1(input: {
  db: Db;
  siteId: string;
  id: string;
  kind: Kind;
  now: Date;
  retentionEligibleAt?: Date;
  beforeStatement: () => Promise<void>;
}): Promise<boolean> {
  const { db, siteId, id, beforeStatement } = input;
  let mutated = false;
  try {
    await beforeStatement();
    const e = await evidence(input),
      b = e.body;
    const releaseId = randomUUID();
    const edges: Edge[] = [];
    const actions: Action[] = [];
    const changeSets: (typeof npAgentChangesets.$inferSelect)[] = [];
    const add = (
      ownerKind: string,
      ownerId: string,
      edgeCode: string,
      ownerEvidenceDigest: string,
    ) => {
      if (
        !edges.some(
          (x) => x.ownerKind === ownerKind && x.ownerId === ownerId && x.edgeCode === edgeCode,
        )
      )
        edges.push({
          siteId,
          sourceReleaseId: releaseId,
          ownerKind,
          ownerId,
          edgeCode,
          ownerEvidenceDigest,
          verifierVersion: 1,
          releasedAt: input.now,
        });
    };
    const cancelledProofs = new Map<string, boolean>();
    const getCancelled = async (invocationId: string): Promise<boolean> => {
      if (cancelledProofs.has(invocationId)) return cancelledProofs.get(invocationId)!;
      cancelledProofs.set(invocationId, false);
      if (b.kind !== "runtime-run" || !e.run) return false;
      await beforeStatement();
      const [invocation] = await db
        .select({ resultId: npAgentInvocations.resultId })
        .from(npAgentInvocations)
        .where(and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, invocationId)))
        .limit(1);
      if (!invocation?.resultId) return false;
      await beforeStatement();
      const [c] = await db
        .select()
        .from(npAgentChangesets)
        .where(
          and(
            eq(npAgentChangesets.siteId, siteId),
            eq(npAgentChangesets.id, invocation.resultId),
            sql`octet_length(to_jsonb(${npAgentChangesets})::text)<=${MAX_REFERENCE_BYTES}`,
          ),
        )
        .limit(1);
      if (!c || (c.runId === id && c.agentConfigHash !== e.run.agentConfigHash)) return false;
      const proof = await npReadCancelledChangeSetLifecycleV1({
        query: (statement) => db.execute(statement),
        changeSet: c,
        source: b,
        releasedAt: input.now,
        beforeStatement,
      });
      if (
        !proof ||
        proof.actions.some((a) => a.runId !== id || a.runSourceReleaseId !== null) ||
        (proof.creator && (c.runId !== id || c.runSourceReleaseId !== null))
      )
        return false;
      for (const edge of proof.edges) add(edge.kind, edge.id, edge.code, edge.digest);
      for (const a of proof.actions) {
        actions.push(a);
        cancelledProofs.set(a.invocationId!, true);
      }
      if (proof.creator) changeSets.push(c);
      return cancelledProofs.get(invocationId) === true;
    };
    // Verify the linked Studio admission once; every other literal reference still pins.
    const studio = async () => {
      if (
        b.kind !== "runtime-run" ||
        !e.run ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          e.run.idempotencyKey,
        )
      )
        return null;
      const [invocation] = await db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, siteId),
            eq(npAgentInvocations.id, e.run.idempotencyKey),
          ),
        )
        .for("update", { noWait: true });
      if (!invocation?.auditEventId) return null;
      const [audit] = await db
        .select()
        .from(npAuditEvents)
        .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.id, invocation.auditEventId)))
        .for("update", { noWait: true });
      if (!audit) return null;
      const proof = await npVerifyAgentReleaseStudioAttributionV1({
        run: e.run,
        invocation,
        audit,
        releasedAt: input.now,
      });
      return proof ? { invocation, audit, ...proof } : null;
    };
    let studioProof: Awaited<ReturnType<typeof studio>> | undefined;
    const getStudio = async () => {
      if (studioProof === undefined) studioProof = await studio();
      return studioProof;
    };
    for (const name of [...npAgentSiteOwnedTableNamesV1, "np_audit_events"]) {
      await beforeStatement();
      const matches = await db.execute(sql`with matching as materialized (
        select dependency.id, to_jsonb(dependency) as body,
          octet_length(to_jsonb(dependency)::text) as body_bytes
        from ${sql.identifier(name)} dependency
        where ${name === "np_audit_events" ? sql`(dependency.site_id=${siteId} or dependency.site_id is null)` : sql`dependency.site_id=${siteId}`}
        ${name === tables[input.kind] ? sql`and dependency.id<>${id}::uuid` : sql``}
        and position(${id} in to_jsonb(dependency)::text)>0 order by dependency.id
        limit ${MAX_REFERENCES + 1} for update nowait
        ) select case when body_bytes<=${MAX_REFERENCE_BYTES}
          and sum(body_bytes) over ()<=${MAX_REFERENCE_BATCH_BYTES}
          then body else null end as body from matching order by id`);
      if (matches.rows.length > MAX_REFERENCES) return false;
      for (const result of matches.rows) {
        if (result.body === null) return false;
        const raw = object(result.body);
        const mask = structuredClone(raw);
        if (typeof raw.id !== "string") return false;
        if (name === "np_audit_events") {
          const [a] = await db
            .select()
            .from(npAuditEvents)
            .where(eq(npAuditEvents.id, raw.id))
            .limit(1);
          if (!a) return false;
          const studioOwner = a.actorKind === "staff" ? await getStudio() : null;
          if (studioOwner?.audit.id === a.id) {
            add("studio-audit", a.id, "audit-target", studioOwner.auditDigest);
            delete mask.target_id;
            if (contains(mask, id)) return false;
            continue;
          }
          const codes = await auditEdges(db, a, e);
          if (!codes) return false;
          for (const code of codes) {
            add("runtime-audit", a.id, code, auditDigest(a));
            if (code === "audit-target") delete mask.target_id;
            else delete object(mask.payload)[code === "audit-run" ? "runId" : "reservationId"];
          }
        } else if (name === "np_agent_source_releases") {
          const [r] = await db
            .select()
            .from(npAgentSourceReleases)
            .where(eq(npAgentSourceReleases.id, raw.id))
            .limit(1);
          if (!r) return false;
          const checked = await npRequireAgentSourceReleaseRecordV1(r);
          // Only these exact typed historical facts are non-live references.
          delete mask.source_id;
          const body = object(mask.evidence_body);
          delete body.sourceId;
          if (checked.kind === "provider-call" || checked.kind === "usage-reservation")
            delete body.runId;
          if (checked.kind === "provider-call") delete body.reservationId;
        } else if (
          ["np_agent_changeset_validation_attempts", "np_agent_changeset_previews"].includes(
            name,
          ) &&
          b.kind === "runtime-run"
        ) {
          if (
            typeof raw.admitting_invocation_id !== "string" ||
            !(await getCancelled(raw.admitting_invocation_id))
          )
            return false;
          delete object(mask.authority_ref).runId;
          delete object(object(mask.authorization_context_body).authorityRef).runId;
        } else if (name === "np_agent_changesets" && b.kind === "runtime-run") {
          if (typeof raw.invocation_id !== "string" || !(await getCancelled(raw.invocation_id)))
            return false;
          delete mask.run_id;
        } else if (
          (name === "np_agent_actions" || name === "np_agent_invocations") &&
          b.kind === "runtime-run"
        ) {
          if (name === "np_agent_invocations") {
            const studioOwner = await getStudio();
            if (studioOwner?.invocation.id === raw.id) {
              add("admin-invocation", raw.id, "invocation-result", studioOwner.invocationDigest);
              delete mask.result_id;
              delete object(mask.output_redacted).id;
              delete object(mask.output_redacted).runId;
              if (contains(mask, id)) return false;
              continue;
            }
          }
          const readActions =
            name === "np_agent_actions"
              ? await db
                  .select()
                  .from(npAgentActions)
                  .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, raw.id)))
                  .limit(1)
              : await db
                  .select()
                  .from(npAgentActions)
                  .where(
                    and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.invocationId, raw.id)),
                  )
                  .limit(2);
          if (readActions.length !== 1) return false;
          const a = readActions[0];
          if (a.runId !== id || a.runSourceReleaseId !== null || !a.invocationId) return false;
          const [i] = await db
            .select()
            .from(npAgentInvocations)
            .where(
              and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, a.invocationId)),
            )
            .for("update", { noWait: true });
          if (!i) return false;
          if (
            ["changeset.create", "changeset.validate", "changeset.preview"].includes(a.capabilityId)
          ) {
            if (!(await getCancelled(i.id))) return false;
            delete mask.run_id;
            if (mask.idempotency_key === `runtime:${id}:${a.sequence.toString()}`)
              delete mask.idempotency_key;
            if (name === "np_agent_invocations") {
              delete object(mask.authority_ref).runId;
              delete object(object(mask.authorization_context_body).authorityRef).runId;
            }
            if (contains(mask, id)) return false;
            continue;
          }
          const proof = await npVerifyAgentReleaseReadAttributionV1({
            action: a,
            invocation: i,
            runId: id,
            runFingerprint: b.admissionFingerprint,
            principalId: b.principalId,
            agentVersionId: b.agentVersionId,
            deadlineAt: b.deadlineAt,
          });
          if (!proof) return false;
          add("read-action", a.id, "action-run", proof.actionDigest);
          add("read-invocation", i.id, "invocation-authority-run", proof.invocationDigest);
          if (!actions.some((x) => x.id === a.id)) actions.push(a);
          // These two immutable keys are derived by the read capability owner
          // from the exact Run and sequence; their bytes remain replay evidence.
          delete mask.idempotency_key;
          if (name === "np_agent_actions") delete mask.run_id;
          else {
            delete object(mask.authority_ref).runId;
            delete object(object(mask.authorization_context_body).authorityRef).runId;
          }
        } else return false;
        if (contains(mask, id)) return false;
      }
    }
    await beforeStatement();
    const jobs = await db.execute(sql`select to_regclass('pgboss.job') is not null as present`);
    if (jobs.rows[0]?.present === true) {
      await beforeStatement();
      const active =
        await db.execute(sql`select 1 from pgboss.job where state::text in ('created','retry','active')
        and (data->>'siteId'=${siteId} or data->>'siteId' is null) and position(${id} in data::text)>0 limit 1`);
      if (active.rows.length) return false;
    }
    // All evidence is now checked. No earlier mutation may survive a protected candidate.
    await beforeStatement();
    mutated = true;
    await db.insert(npAgentSourceReleases).values({
      id: releaseId,
      siteId,
      sourceKind: b.kind,
      sourceId: id,
      evidenceBody: b,
      evidenceDigest: await npDigestAgentSourceReleaseV1(b),
      releasedAt: input.now,
      principalId: b.kind === "runtime-run" ? b.principalId : null,
      admissionKeyDigest: b.kind === "runtime-run" ? b.admissionKeyDigest : null,
    });
    if (edges.length) {
      await beforeStatement();
      await db.insert(npAgentSourceReleaseEdges).values(edges);
    }
    for (const a of actions) {
      await beforeStatement();
      const changed = await db
        .update(npAgentActions)
        .set({ runId: null, runSourceReleaseId: releaseId })
        .where(
          and(
            eq(npAgentActions.siteId, siteId),
            eq(npAgentActions.id, a.id),
            eq(npAgentActions.runId, id),
            eq(npAgentActions.inputHash, a.inputHash),
            eq(npAgentActions.state, a.state),
          ),
        )
        .returning({ id: npAgentActions.id });
      if (changed.length !== 1) invalid();
    }
    for (const c of changeSets) {
      await beforeStatement();
      const changed = await db
        .update(npAgentChangesets)
        .set({ runId: null, runSourceReleaseId: releaseId })
        .where(
          and(
            eq(npAgentChangesets.siteId, siteId),
            eq(npAgentChangesets.id, c.id),
            eq(npAgentChangesets.runId, id),
            eq(npAgentChangesets.state, "cancelled"),
            eq(npAgentChangesets.draftHash, c.draftHash),
          ),
        )
        .returning({ id: npAgentChangesets.id });
      if (changed.length !== 1) invalid();
    }
    return true;
  } catch (error) {
    if (
      !mutated &&
      (error instanceof NpAgentContractError ||
        (error instanceof NpAgentGatewayError && error.code !== "RUNTIME_MAINTENANCE_TIMEOUT"))
    )
      return false;
    throw error;
  }
}
