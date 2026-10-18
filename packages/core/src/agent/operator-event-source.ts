import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npAgentEvents, npAgentOperatorPlans } from "../db/schema/agent.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { npRequireAgentEventCanonical } from "../agent-contract/canonical-events.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentOperatorCapabilityInputV1 } from "../agent-contract/operator-capability-contract.js";
import {
  npAssessAgentOperatorRecoveryV1,
  npRequireAgentOperatorMonitorSnapshotV1,
  type NpAgentOperatorMonitorSnapshotV1,
  type NpAgentOperatorRecoveryAssessmentV1,
} from "../agent-contract/operator-monitor-contract.js";
import type {
  NpAgentEventCanonicalV1,
  NpAgentEventPayload,
  NpAgentJsonObject,
} from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npReadAgentEventRowEvidenceV1 } from "./event-evidence.js";
import {
  npRequireAgentGuardianOperatorCoverageV1,
  type NpAgentGuardianOperatorCoverageV1,
} from "../agent-contract/guardian-operator-coverage-contract.js";
import {
  npCollectAgentOperatorEventObservationV1,
  type NpAgentOperatorEventObservationV1,
} from "./operator-event-observation.js";

type Db = ReturnType<typeof getDb>;
type CheckState = "pass" | "warn" | "fail" | "unknown";
export interface NpAgentOperatorSourceStatusV1 {
  observedAt: string;
  checks: Array<{ id: string; state: CheckState }>;
  /** Failed is emitted only when the owning source records a failure, never inferred from missing files. */
  backup: {
    state: "observed" | "unknown";
    artifactId: string | null;
    failed: boolean;
    stale: boolean;
    failureReasonCode?: "BACKUP_CREATE_FAILED" | "BACKUP_RESTORE_DRILL_FAILED";
  };
}
export interface NpAgentOperatorEventSourceOptionsV1 {
  db?: Db;
  now?: () => Date;
  /** Explicit allowlist. Reconciliation over other sites performs no source reads or writes. */
  isInstalledSite(siteId: string): Promise<boolean>;
  /** Must resolve current site AND deployment authority. No ambient job caller authority. */
  authorize(input: { siteId: string; db: Db }): Promise<void>;
  events: {
    record(input: { siteId: string; event: NpAgentEventCanonicalV1; db: Db }): Promise<unknown>;
  };
  staleAfterSeconds: number;
  minimumPendingJobs: number;
  heartbeatFreshSeconds?: number;
  /** Selecting pg-boss is explicit; absent evidence owners stay unknown. */
  jobs?: "pg-boss";
  /** Host-owned source adapter for custom queues; must return complete bounded measured facts. */
  observeJobs?(input: {
    afterFailure?: { completedAt: string; jobId: string };
  }): Promise<NpAgentOperatorEventObservationV1>;
  observeStatus?(input: { siteId: string }): Promise<NpAgentOperatorSourceStatusV1>;
}
interface MonitorRecord {
  schemaVersion: "np.agent-operator-recovery.v1";
  monitorId: string;
  planId: string;
  planDigest: string;
  queue: string | null;
  startedAt: string;
  sampledAt: string;
  deadline: string;
  before: NpAgentOperatorMonitorSnapshotV1;
  after: NpAgentOperatorMonitorSnapshotV1;
  assessment: NpAgentOperatorRecoveryAssessmentV1;
  revision: number;
}
const SOURCE_TARGET = "agent-operator-source";
const MONITOR_TARGET = "agent-operator-monitor";
function fail(): never {
  throw new NpAgentGatewayError(
    "OPERATOR_SOURCE_UNAVAILABLE",
    503,
    "Operator source is unavailable.",
  );
}
const hash = (value: unknown) =>
  createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("hex");
const planDigest = (value: unknown) =>
  `cj1:sha256:${createHash("sha256").update("np.agent-operator-plan-artifact.v1\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const utc = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
function readStatus(
  input: NpAgentOperatorSourceStatusV1,
  now: Date,
): NpAgentOperatorSourceStatusV1 {
  if (
    !input ||
    !utc(input.observedAt) ||
    Date.parse(input.observedAt) > now.getTime() ||
    now.getTime() - Date.parse(input.observedAt) > 300000 ||
    !Array.isArray(input.checks) ||
    input.checks.length > 100 ||
    new Set(input.checks.map((c) => c.id)).size !== input.checks.length ||
    input.checks.some(
      (c) =>
        !/^[a-z][a-z0-9_-]{0,39}(?:\.[a-z][a-z0-9_-]{0,39})*$/.test(c.id) ||
        c.id.length > 96 ||
        !["pass", "warn", "fail", "unknown"].includes(c.state),
    ) ||
    !input.backup ||
    !["observed", "unknown"].includes(input.backup.state) ||
    typeof input.backup.failed !== "boolean" ||
    typeof input.backup.stale !== "boolean" ||
    (input.backup.failureReasonCode !== undefined &&
      !["BACKUP_CREATE_FAILED", "BACKUP_RESTORE_DRILL_FAILED"].includes(
        input.backup.failureReasonCode,
      )) ||
    (input.backup.artifactId !== null &&
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.backup.artifactId))
  )
    return fail();
  return {
    observedAt: input.observedAt,
    checks: input.checks.map((c) => ({ id: c.id, state: c.state })),
    backup: {
      state: input.backup.state,
      artifactId: input.backup.artifactId,
      failed: input.backup.failed,
      stale: input.backup.stale,
      ...(input.backup.failureReasonCode
        ? { failureReasonCode: input.backup.failureReasonCode }
        : {}),
    },
  };
}
/** Explicit source/monitor factory; installs no schedules, credentials, workers or capability executors. */
export function createAgentOperatorEventSourceV1(options: NpAgentOperatorEventSourceOptionsV1) {
  if (
    !Number.isSafeInteger(options.staleAfterSeconds) ||
    options.staleAfterSeconds < 60 ||
    options.staleAfterSeconds > 86400 ||
    !Number.isSafeInteger(options.minimumPendingJobs) ||
    options.minimumPendingJobs < 1 ||
    options.minimumPendingJobs > 100000
  )
    fail();
  const fresh = options.heartbeatFreshSeconds ?? 90;
  if (!Number.isSafeInteger(fresh) || fresh < 1 || fresh > 86400) fail();
  const now = () => {
    const date = options.now?.() ?? new Date();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail();
    return date;
  };
  const database = () => options.db ?? getDb();
  async function access(siteId: string, db: Db) {
    if (!npIsCanonicalSiteId(siteId) || !(await options.isInstalledSite(siteId))) fail();
    await options.authorize({ siteId, db });
  }
  async function observation(
    siteId: string,
    afterFailure?: { completedAt: string; jobId: string },
  ) {
    const db = database();
    await access(siteId, db);
    const value = options.observeJobs
      ? await options.observeJobs({ afterFailure })
      : options.jobs === "pg-boss"
        ? await npCollectAgentOperatorEventObservationV1({ db, afterFailure })
        : {
            snapshot: {
              schemaVersion: "np.agent-operator-monitor-snapshot.v1" as const,
              observedAt: now().toISOString(),
              complete: false,
              paused: null,
              queues: [],
              workers: [],
            },
            failures: [],
            failuresComplete: false,
          };
    const snapshot = npRequireAgentOperatorMonitorSnapshotV1(value.snapshot);
    if (
      Date.parse(snapshot.observedAt) > now().getTime() ||
      now().getTime() - Date.parse(snapshot.observedAt) > 300000 ||
      !Array.isArray(value.failures) ||
      value.failures.length > 100
    )
      fail();
    const failures = value.failures.map((f) => {
      if (
        !/^[A-Za-z0-9_.\-/]{1,96}$/.test(f.handlerName) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(f.jobId) ||
        !utc(f.completedAt) ||
        Date.parse(f.completedAt) > now().getTime()
      )
        return fail();
      return { handlerName: f.handlerName, jobId: f.jobId, completedAt: f.completedAt };
    });
    await access(siteId, db);
    return { snapshot, failures, failuresComplete: value.failuresComplete === true };
  }
  async function locked<T>(siteId: string, key: string, run: (db: Db) => Promise<T>): Promise<T> {
    npAssertAgentPreviewEffectsAllowed();
    return database().transaction(async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`np.operator:${siteId}:${key}`},0))`,
      );
      await access(siteId, db);
      const result = await run(db);
      await access(siteId, db);
      return result;
    });
  }
  async function append(
    db: Db,
    siteId: string,
    targetType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ) {
    await db.insert(npAuditEvents).values({
      id: randomUUID(),
      siteId,
      actorKind: "system",
      action:
        targetType === SOURCE_TARGET
          ? "agents.operator.source.observed"
          : "agents.operator.recovery.observed",
      targetType,
      targetId,
      payload,
      createdAt: now(),
    });
  }
  async function latest(db: Db, siteId: string, type: string, id: string) {
    const [row] = await db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.siteId, siteId),
          eq(npAuditEvents.targetType, type),
          eq(npAuditEvents.targetId, id),
        ),
      )
      .orderBy(
        desc(sql`coalesce((${npAuditEvents.payload}->>'revision')::integer,0)`),
        desc(npAuditEvents.createdAt),
        desc(npAuditEvents.id),
      )
      .limit(1);
    return row?.payload;
  }
  async function emit(
    db: Db,
    siteId: string,
    payload: NpAgentEventPayload,
    stableIdentity: unknown,
    occurredAt: string,
  ) {
    const event = npRequireAgentEventCanonical({
      version: "np.agent-event.v1",
      siteId,
      kind: payload.kind,
      occurredAt,
      source: {
        kind: payload.kind.startsWith("jobs.") ? "jobs" : "ops",
        component: "operator-source",
      },
      subject: { kind: "site", siteId },
      actor: null,
      causation: null,
      correlationId: null,
      deduplicationKey: `operator:${hash({ siteId, kind: payload.kind, payload, stableIdentity })}`,
      privacy: "internal",
      payload,
    });
    await options.events.record({ siteId, event, db });
  }
  async function observe(input: { siteId: string }) {
    if (!npIsCanonicalSiteId(input.siteId)) fail();
    if (!(await options.isInstalledSite(input.siteId)))
      return { state: "disabled" as const, emitted: 0 };
    await access(input.siteId, database());
    const checkpoint = await latest(database(), input.siteId, SOURCE_TARGET, "canonical");
    const storedCursor = checkpoint?.failureCursor as
      { completedAt?: unknown; jobId?: unknown } | undefined;
    const afterFailure =
      storedCursor && utc(storedCursor.completedAt) && typeof storedCursor.jobId === "string"
        ? { completedAt: storedCursor.completedAt, jobId: storedCursor.jobId }
        : undefined;
    const { snapshot, failures, failuresComplete } = await observation(input.siteId, afterFailure);
    const status = options.observeStatus
      ? readStatus(await options.observeStatus(input), now())
      : null;
    return locked(input.siteId, "source", async (db) => {
      const previous = await latest(db, input.siteId, SOURCE_TARGET, "canonical");
      const priorChecks =
        previous?.checks && typeof previous.checks === "object"
          ? (previous.checks as Record<string, unknown>)
          : {};
      const checks: Record<string, CheckState> = {};
      let emitted = 0;
      for (const failure of failures) {
        await emit(
          db,
          input.siteId,
          {
            kind: "jobs.handler.failed",
            handlerName: failure.handlerName,
            jobId: failure.jobId,
            reasonCode: "RECORDED_HANDLER_FAILURE",
          },
          failure,
          failure.completedAt,
        );
        emitted++;
      }
      if (snapshot.complete && snapshot.paused === false) {
        const window = Math.floor(now().getTime() / (options.staleAfterSeconds * 1000));
        const aged = snapshot.queues.filter(
          (q) =>
            q.ready >= options.minimumPendingJobs &&
            (q.oldestReadyAgeSeconds ?? -1) >= options.staleAfterSeconds,
        );
        for (const queue of aged) {
          const countBucket = Math.min(2147483647, 2 ** Math.floor(Math.log2(queue.ready)));
          await emit(
            db,
            input.siteId,
            {
              kind: "jobs.backlog.threshold",
              handlerName: queue.name,
              countBucket,
              threshold: options.minimumPendingJobs,
            },
            { queue: queue.name, threshold: options.minimumPendingJobs, window },
            new Date(window * options.staleAfterSeconds * 1000).toISOString(),
          );
          emitted++;
        }
        for (const worker of snapshot.workers) {
          if (
            worker.state !== "active" ||
            now().getTime() - Date.parse(worker.lastHeartbeatAt) <
              options.staleAfterSeconds * 1000 ||
            !worker.queues.some((q) => aged.some((a) => a.name === q))
          )
            continue;
          await emit(
            db,
            input.siteId,
            {
              kind: "jobs.worker.stale",
              workerId: worker.id,
              lastHeartbeatAt: worker.lastHeartbeatAt,
            },
            { workerId: worker.id, heartbeat: worker.lastHeartbeatAt },
            new Date(
              Date.parse(worker.lastHeartbeatAt) + options.staleAfterSeconds * 1000,
            ).toISOString(),
          );
          emitted++;
        }
      }
      for (const check of status?.checks ?? []) {
        checks[check.id] = check.state;
        const previousStatus = priorChecks[check.id];
        if (
          typeof previousStatus === "string" &&
          ["pass", "warn", "fail", "unknown"].includes(previousStatus) &&
          previousStatus !== check.state
        ) {
          await emit(
            db,
            input.siteId,
            {
              kind: "ops.check.changed",
              checkId: check.id,
              previousStatus: previousStatus as CheckState,
              currentStatus: check.state,
            },
            {
              check: check.id,
              previousStatus,
              currentStatus: check.state,
              source: status!.observedAt,
            },
            status!.observedAt,
          );
          emitted++;
        }
      }
      if (status?.backup.state === "observed") {
        const backup = status.backup;
        for (const kind of ["ops.backup.failed", "ops.backup.stale"] as const) {
          if (!(kind === "ops.backup.failed" ? backup.failed : backup.stale)) continue;
          await emit(
            db,
            input.siteId,
            {
              kind,
              artifactId: backup.artifactId,
              reasonCode:
                kind === "ops.backup.failed"
                  ? (backup.failureReasonCode ?? "RECORDED_BACKUP_FAILURE")
                  : "BACKUP_FRESHNESS_EXCEEDED",
            },
            { artifactId: backup.artifactId, window: Math.floor(now().getTime() / 3600000) },
            new Date(Math.floor(now().getTime() / 3600000) * 3600000).toISOString(),
          );
          emitted++;
        }
      }
      const oldCursor = previous?.failureCursor as
        { completedAt: string; jobId: string } | undefined;
      const candidates = [
        ...failures.map((f) => ({ completedAt: f.completedAt, jobId: f.jobId })),
        ...(oldCursor ? [oldCursor] : []),
      ].sort(
        (a, b) => a.completedAt.localeCompare(b.completedAt) || a.jobId.localeCompare(b.jobId),
      );
      const failureCursor = candidates.at(-1) ?? null;
      await append(db, input.siteId, SOURCE_TARGET, "canonical", {
        schemaVersion: "np.agent-operator-source.v1",
        checks,
        observedAt: snapshot.observedAt,
        complete: snapshot.complete,
        paused: snapshot.paused,
        failuresComplete,
        failureCursor,
        statusObserved: status !== null,
        emitted,
        revision: typeof previous?.revision === "number" ? previous.revision + 1 : 1,
      });
      return { state: "observed" as const, emitted };
    });
  }
  async function startMonitor(input: { siteId: string; planId: string; windowSeconds?: number }) {
    const window = input.windowSeconds ?? 900;
    if (
      !Number.isSafeInteger(window) ||
      window < 60 ||
      window > 3600 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.planId)
    )
      fail();
    const { snapshot } = await observation(input.siteId);
    return locked(input.siteId, `monitor-plan:${input.planId}`, async (db) => {
      const [plan] = await db
        .select()
        .from(npAgentOperatorPlans)
        .where(
          and(
            eq(npAgentOperatorPlans.siteId, input.siteId),
            eq(npAgentOperatorPlans.id, input.planId),
          ),
        )
        .limit(1);
      if (
        !plan ||
        plan.expiresAt <= now() ||
        plan.createdAt > now() ||
        plan.contractId !== "runbook" ||
        plan.artifactCanonical.runbook !== "worker-not-draining" ||
        planDigest({
          operation: plan.operation,
          contractId: plan.contractId,
          artifact: plan.artifactCanonical,
        }) !== plan.artifactDigest
      )
        fail();
      const operation = npRequireAgentOperatorCapabilityInputV1("ops.plan", plan.operation);
      if (operation.action !== "queue.global.plan" || operation.target.operation !== "drain")
        fail();
      const prior = await latest(db, input.siteId, MONITOR_TARGET, input.planId);
      if (prior) return { monitorId: input.planId, replayed: true };
      const started = now();
      const body: MonitorRecord = {
        schemaVersion: "np.agent-operator-recovery.v1",
        monitorId: input.planId,
        planId: plan.id,
        planDigest: plan.artifactDigest,
        queue: operation.target.jobName,
        startedAt: started.toISOString(),
        sampledAt: started.toISOString(),
        deadline: new Date(started.getTime() + window * 1000).toISOString(),
        before: snapshot,
        after: npRequireAgentOperatorMonitorSnapshotV1(snapshot),
        assessment: {
          state:
            snapshot.paused === true
              ? "paused"
              : !snapshot.complete || snapshot.paused === null
                ? "unknown"
                : "monitoring",
          reason:
            snapshot.paused === true
              ? "intentional-pause"
              : !snapshot.complete || snapshot.paused === null
                ? "incomplete-evidence"
                : "waiting",
          beforePending: null,
          afterPending: null,
        },
        revision: 1,
      };
      await append(db, input.siteId, MONITOR_TARGET, input.planId, {
        ...body,
        bodyHash: hash(body),
      });
      return { monitorId: input.planId, replayed: false };
    });
  }
  async function sampleMonitor(input: { siteId: string; monitorId: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.monitorId))
      fail();
    const { snapshot } = await observation(input.siteId);
    return locked(input.siteId, `monitor-plan:${input.monitorId}`, async (db) => {
      const raw = await latest(db, input.siteId, MONITOR_TARGET, input.monitorId);
      if (!raw) fail();
      const { bodyHash, ...candidate } = raw;
      if (
        bodyHash !== hash(candidate) ||
        candidate.schemaVersion !== "np.agent-operator-recovery.v1" ||
        candidate.monitorId !== input.monitorId
      )
        fail();
      const prior = candidate as unknown as MonitorRecord;
      if (prior.assessment.state === "recovered" || prior.assessment.state === "timed-out")
        return { monitorId: input.monitorId, ...prior.assessment, replayed: true };
      const [plan] = await db
        .select()
        .from(npAgentOperatorPlans)
        .where(
          and(
            eq(npAgentOperatorPlans.siteId, input.siteId),
            eq(npAgentOperatorPlans.id, prior.planId),
          ),
        )
        .limit(1);
      if (
        !plan ||
        plan.artifactDigest !== prior.planDigest ||
        planDigest({
          operation: plan.operation,
          contractId: plan.contractId,
          artifact: plan.artifactCanonical,
        }) !== prior.planDigest
      )
        fail();
      if (
        now().getTime() < Date.parse(prior.deadline) &&
        (Date.parse(snapshot.observedAt) <= Date.parse(prior.after.observedAt) ||
          now().getTime() - Date.parse(prior.sampledAt) < 30000)
      )
        return { monitorId: input.monitorId, ...prior.assessment, replayed: true };
      const assessment = npAssessAgentOperatorRecoveryV1({
        before: prior.before,
        after: snapshot,
        queue: prior.queue,
        now: now().toISOString(),
        deadline: prior.deadline,
        heartbeatFreshSeconds: fresh,
      });
      // 1-hour maximum window sampled at >=30s requires at most 122 retained revisions.
      if (prior.revision >= 128) fail();
      const next: MonitorRecord = {
        ...prior,
        after: snapshot,
        sampledAt: now().toISOString(),
        assessment,
        revision: prior.revision + 1,
      };
      await append(db, input.siteId, MONITOR_TARGET, input.monitorId, {
        ...next,
        bodyHash: hash(next),
      });
      return { monitorId: input.monitorId, ...assessment, replayed: false };
    });
  }
  async function sampleDueMonitors(input: { siteId: string }) {
    if (!npIsCanonicalSiteId(input.siteId)) fail();
    if (!(await options.isInstalledSite(input.siteId))) return { sampled: 0 };
    await access(input.siteId, database());
    // Statement-time and batch bounds also cover monitors whose host was offline past the deadline.
    // The oldest sampled monitors rotate first; terminal monitors cannot consume the batch cap.
    const rows = await database().transaction(
      async (db) => {
        await db.execute(sql`select set_config('statement_timeout','500ms',true)`);
        return db.execute(
          sql`with latest as (select distinct on (target_id) target_id, payload, created_at as last_recorded from np_audit_events where site_id=${input.siteId} and target_type=${MONITOR_TARGET} order by target_id, (payload->>'revision')::integer desc, created_at desc, id desc) select * from latest where payload->'assessment'->>'state' not in ('recovered','timed-out') order by last_recorded asc, target_id limit 25`,
        );
      },
      { accessMode: "read only" },
    );
    let sampled = 0;
    for (const row of rows.rows) {
      const payload = row.payload as Record<string, unknown>;
      const assessment = payload.assessment as Record<string, unknown> | undefined;
      if (
        typeof row.target_id !== "string" ||
        !assessment ||
        assessment.state === "recovered" ||
        assessment.state === "timed-out"
      )
        continue;
      await sampleMonitor({ siteId: input.siteId, monitorId: row.target_id });
      sampled++;
    }
    await access(input.siteId, database());
    return { sampled };
  }
  /** Reads existing persisted source facts only. Caller owns the DB timeout/current staff ACL.
   * This neither polls a queue/health adapter nor recreates Operator Events as Guardian Signals. */
  async function coverage(input: {
    db: Db;
    siteId: string;
  }): Promise<NpAgentGuardianOperatorCoverageV1> {
    const absent = (state: "disabled" | "not-observed" | "unavailable") =>
      npRequireAgentGuardianOperatorCoverageV1({
        schemaVersion: "np.agent-guardian-operator-coverage.v1",
        basis: "operator-recorded-facts",
        state,
        observedAt: null,
        jobs: { complete: null, paused: null, failuresComplete: null },
        health: { observed: null },
        events: { sampled: null, invalid: null, truncated: false },
      });
    if (!npIsCanonicalSiteId(input.siteId)) fail();
    if (!(await options.isInstalledSite(input.siteId))) return absent("disabled");
    try {
      await access(input.siteId, input.db);
      const at = now();
      const [record] = await input.db
        .select({
          actorKind: npAuditEvents.actorKind,
          actorUserId: npAuditEvents.actorUserId,
          actorMemberId: npAuditEvents.actorMemberId,
          createdAt: npAuditEvents.createdAt,
          payload: sql<NpAgentJsonObject | null>`case when octet_length(${npAuditEvents.payload}::text)<=16384 then ${npAuditEvents.payload} else null end`,
        })
        .from(npAuditEvents)
        .where(
          and(
            eq(npAuditEvents.siteId, input.siteId),
            eq(npAuditEvents.targetType, SOURCE_TARGET),
            eq(npAuditEvents.targetId, "canonical"),
            eq(npAuditEvents.action, "agents.operator.source.observed"),
          ),
        )
        .orderBy(
          desc(
            sql`case when ${npAuditEvents.payload}->>'revision' ~ '^[1-9][0-9]{0,9}$' then (${npAuditEvents.payload}->>'revision')::bigint end`,
          ),
          desc(npAuditEvents.createdAt),
          desc(npAuditEvents.id),
        )
        .limit(1);
      if (!record) {
        await access(input.siteId, input.db);
        return absent("not-observed");
      }
      const value = record.payload;
      if (!value) fail();
      if (
        record.actorKind !== "system" ||
        record.actorUserId !== null ||
        record.actorMemberId !== null ||
        record.createdAt > at ||
        value.schemaVersion !== "np.agent-operator-source.v1" ||
        !utc(value.observedAt) ||
        Date.parse(value.observedAt) > at.getTime() ||
        typeof value.complete !== "boolean" ||
        typeof value.failuresComplete !== "boolean" ||
        typeof value.statusObserved !== "boolean" ||
        (value.paused !== undefined && value.paused !== null && typeof value.paused !== "boolean")
      )
        fail();
      const rows = await input.db
        .select()
        .from(npAgentEvents)
        .where(
          and(
            eq(npAgentEvents.siteId, input.siteId),
            eq(npAgentEvents.sourceComponent, "operator-source"),
            inArray(npAgentEvents.kind, [
              "jobs.handler.failed",
              "jobs.worker.stale",
              "jobs.backlog.threshold",
              "ops.check.changed",
              "ops.backup.failed",
              "ops.backup.stale",
            ]),
            gte(npAgentEvents.recordedAt, new Date(at.getTime() - 86400000)),
          ),
        )
        .orderBy(desc(npAgentEvents.recordedAt), desc(npAgentEvents.id))
        .limit(101);
      let invalid = 0;
      for (const row of rows.slice(0, 100)) {
        try {
          const event = await npReadAgentEventRowEvidenceV1(row);
          if (
            event.source.kind !== (event.kind.startsWith("jobs.") ? "jobs" : "ops") ||
            event.subject?.kind !== "site" ||
            event.subject.siteId !== input.siteId ||
            event.actor !== null ||
            event.causation !== null ||
            event.correlationId !== null ||
            event.privacy !== "internal" ||
            !event.deduplicationKey?.startsWith("operator:") ||
            row.recordedAt > at
          )
            invalid++;
        } catch {
          invalid++;
        }
      }
      await access(input.siteId, input.db);
      return npRequireAgentGuardianOperatorCoverageV1({
        schemaVersion: "np.agent-guardian-operator-coverage.v1",
        basis: "operator-recorded-facts",
        state: at.getTime() - Date.parse(value.observedAt) > 300000 ? "stale" : "observed",
        observedAt: value.observedAt,
        jobs: {
          complete: value.complete,
          paused: value.paused ?? null,
          failuresComplete: value.failuresComplete,
        },
        health: { observed: value.statusObserved },
        events: { sampled: Math.min(rows.length, 100), invalid, truncated: rows.length > 100 },
      });
    } catch {
      return absent("unavailable");
    }
  }
  return { observe, startMonitor, sampleMonitor, sampleDueMonitors, coverage };
}
export type NpAgentOperatorEventSourceV1 = ReturnType<typeof createAgentOperatorEventSourceV1>;
