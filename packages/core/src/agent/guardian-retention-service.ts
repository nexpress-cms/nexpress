import { randomUUID } from "node:crypto";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentEvents,
  npAgentSignals,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../db/schema/agent.js";
import { npAgentContentReceipts } from "../db/schema/guardian.js";
import { npAgentRuntimeReceipts } from "../db/schema/guardian-runtime.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npSettings } from "../db/schema/system.js";
import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import {
  npAgentGuardianRetentionFamiliesV1,
  npAgentGuardianSourcePairsV1,
  npAgentGuardianSourceNamespaceDigestV1,
  npAgentGuardianSourceDeliveryKeyDigestV1,
  npDigestAgentGuardianRetentionValueV1,
  npRequireAgentGuardianSourceClosureV1,
  type NpAgentGuardianRetentionFamilyV1,
  type NpAgentGuardianSourceClosureV1,
} from "../agent-contract/guardian-retention-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npAgentGuardianOperationsDetectorsV1,
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import {
  npRequireAgentSourceReleaseV1,
  npDigestAgentSourceReleaseV1,
} from "../agent-contract/source-release-contract.js";
import { npRequireAgentSecurityTransitionPayloadV1 } from "../agent-contract/guardian-security-contract.js";
import { npWithAgentRuntimeRetentionBudgetV1 } from "./runtime-retention-budget.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npLockAgentSourceReleaseFenceV1 } from "./source-release.js";
import { npSourceReleaseOwnerDigestV1 } from "./source-release-read.js";
import { npAgentSiteOwnedTableNamesV1 } from "./site-deletion.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import { npPruneAgentIncidentRetentionV1 } from "./incident-retention.js";
import {
  npAgentGuardianSourceClosureKeyV1,
  npReadAgentGuardianSourceClosureV1,
} from "./guardian-source-closure.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

type Db = ReturnType<typeof getDb>;
type Event = typeof npAgentEvents.$inferSelect;
type Audit = typeof npAuditEvents.$inferSelect;
type Receipt =
  typeof npAgentContentReceipts.$inferSelect | typeof npAgentRuntimeReceipts.$inferSelect;
const receiptTables = { content: npAgentContentReceipts, runtime: npAgentRuntimeReceipts } as const;
type ReceiptFamily = keyof typeof receiptTables;
const receiptTableName = (family: ReceiptFamily) =>
  family === "content" ? "np_agent_content_receipts" : "np_agent_runtime_receipts";
const DAY = 86400000,
  WINDOW = 600000;
export interface NpAgentGuardianRetentionPolicyV1 {
  version: 1;
  eventDays: number;
  receiptDays: number;
  signalDays: number;
  historyDays: number;
}
export interface NpAgentGuardianRetentionReceiptProofV1 {
  sourceProofDigest: string;
  occurredAt: string;
  state: "pending" | "blocked" | "emitted" | "sampled" | "held";
  emittedEventId: string | null;
}
export interface NpAgentGuardianRetentionProofOwnerV1 {
  family: NpAgentGuardianRetentionFamilyV1;
  verifyEvent(input: {
    db: Db;
    siteId: string;
    eventId: string;
  }): Promise<NpAgentGuardianVerifiedEventV1>;
  /** Actual detector rule owner. Event MACs alone never prove threshold or subject cohorts. */
  verifySignal?(input: { db: Db; siteId: string; signalId: string }): Promise<boolean>;
  verifyReceipt?(input: {
    db: Db;
    siteId: string;
    receiptId: string;
  }): Promise<NpAgentGuardianRetentionReceiptProofV1>;
}
export interface NpAgentGuardianRetentionOptionsV1 {
  policy: NpAgentGuardianRetentionPolicyV1;
  authorize(input: { db: Db; siteId: string }): Promise<void>;
  proofOwners: readonly NpAgentGuardianRetentionProofOwnerV1[];
  now?: () => Date;
}
export type NpAgentGuardianRetentionSkipReasonV1 =
  | "PROOF_UNAVAILABLE"
  | "REFERENCE_PINNED"
  | "NOT_ELIGIBLE"
  | "UNSUPPORTED_SOURCE"
  | "DELIVERY_NOT_CLOSED"
  | "COHORT_PINNED"
  | "RELEASE_CONFLICT";
export interface NpAgentGuardianRetentionResultV1 {
  examined: number;
  eventsPruned: number;
  receiptsPruned: number;
  historyPruned: number;
  closuresAdvanced: number;
  nextCursor: string | null;
  skipped: { reason: NpAgentGuardianRetentionSkipReasonV1; count: number }[];
}
export interface NpAgentGuardianRetentionServiceV1 {
  prune(input: {
    siteId: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<NpAgentGuardianRetentionResultV1>;
}
function invalid(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_RETENTION_UNAVAILABLE",
    409,
    "Guardian retained evidence is unavailable.",
  );
}
const uuid = (value: unknown) => canonicalBodyUuid(value, "guardian.retention.id");
/** Matches established source-release audit attribution; profile anonymization fields are excluded. */
export function npGuardianRetentionAuditOwnerDigestV1(audit: Audit): string {
  return npSourceReleaseOwnerDigestV1({
    id: audit.id,
    siteId: audit.siteId,
    actorKind: audit.actorKind,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId,
    payload: audit.payload,
    createdAt: audit.createdAt.toISOString(),
  });
}
/** A compact commitment to the proofs checked at release, not retained MAC-verification authority. */
export async function npGuardianRetentionSourceProofDigestV1(input: {
  event: NpAgentGuardianVerifiedEventV1;
  auditDigest: string | null;
  receiptDigest: string | null;
}): Promise<string> {
  return npDigestAgentGuardianRetentionValueV1("np.agent-guardian-source-proof.v1", {
    event: npRequireAgentGuardianVerifiedEventV1(input.event),
    auditDigest:
      input.auditDigest === null
        ? null
        : canonicalBodySha256Digest(input.auditDigest, "guardian.retention.auditDigest"),
    receiptDigest:
      input.receiptDigest === null
        ? null
        : canonicalBodySha256Digest(input.receiptDigest, "guardian.retention.receiptDigest"),
  });
}
function policy(value: unknown): NpAgentGuardianRetentionPolicyV1 {
  const p = "guardian.retention.policy",
    keys = ["version", "eventDays", "receiptDays", "signalDays", "historyDays"],
    r = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, p, 1024), p, keys, keys, {
      seen: new WeakSet(),
    });
  return {
    version: canonicalBodyInteger(r.version, p, 1, 1) as 1,
    eventDays: canonicalBodyInteger(r.eventDays, p, 1, 14),
    receiptDays: canonicalBodyInteger(r.receiptDays, p, 1, 90),
    signalDays: canonicalBodyInteger(r.signalDays, p, 1, 90),
    historyDays: canonicalBodyInteger(r.historyDays, p, 1, 365),
  };
}
function familyOf(
  event: Pick<Event, "sourceComponent" | "kind">,
): NpAgentGuardianRetentionFamilyV1 | null {
  for (const family of npAgentGuardianRetentionFamiliesV1)
    if (
      Object.entries(npAgentGuardianSourcePairsV1[family]).some(
        ([component, kind]) => event.sourceComponent === component && event.kind === kind,
      )
    )
      return family;
  return null;
}
/** Explicit host maintenance only. No jobs are installed and no terminal effect/advisory graph is released. */
export function createAgentGuardianRetentionServiceV1(
  options: NpAgentGuardianRetentionOptionsV1,
): NpAgentGuardianRetentionServiceV1 {
  const retention = policy(options.policy);
  if (
    typeof options.authorize !== "function" ||
    !Array.isArray(options.proofOwners) ||
    options.proofOwners.length > npAgentGuardianRetentionFamiliesV1.length ||
    (options.now !== undefined && typeof options.now !== "function")
  )
    invalid();
  const owners = new Map<NpAgentGuardianRetentionFamilyV1, NpAgentGuardianRetentionProofOwnerV1>();
  for (const owner of options.proofOwners) {
    if (
      !owner ||
      !Object.hasOwn(npAgentGuardianSourcePairsV1, owner.family) ||
      owners.has(owner.family) ||
      typeof owner.verifyEvent !== "function" ||
      (owner.verifySignal !== undefined && typeof owner.verifySignal !== "function") ||
      (owner.verifyReceipt !== undefined &&
        (!Object.hasOwn(receiptTables, owner.family) || typeof owner.verifyReceipt !== "function"))
    )
      invalid();
    owners.set(owner.family, {
      family: owner.family,
      verifyEvent: owner.verifyEvent.bind(owner),
      ...(owner.verifySignal ? { verifySignal: owner.verifySignal.bind(owner) } : {}),
      ...(owner.verifyReceipt ? { verifyReceipt: owner.verifyReceipt.bind(owner) } : {}),
    });
  }
  const authorize = options.authorize.bind(options),
    now = options.now ?? (() => new Date());
  return {
    async prune(input) {
      npAssertAgentPreviewEffectsAllowed();
      const siteId = canonicalBodySiteId(input.siteId, "guardian.retention.siteId"),
        cursor = input.cursor === undefined || input.cursor === null ? null : uuid(input.cursor),
        limit = canonicalBodyInteger(input.limit ?? 25, "guardian.retention.limit", 1, 25);
      const time = now();
      if (!(time instanceof Date) || !Number.isFinite(time.getTime())) invalid();
      const at = new Date(time),
        eventBefore = new Date(at.getTime() - retention.eventDays * DAY),
        receiptBefore = new Date(at.getTime() - retention.receiptDays * DAY),
        signalBefore = new Date(at.getTime() - retention.signalDays * DAY),
        historyBefore = new Date(at.getTime() - retention.historyDays * DAY),
        boundary = new Date(Math.floor(eventBefore.getTime() / WINDOW) * WINDOW).toISOString();
      try {
        return await npWithAgentRuntimeRetentionBudgetV1((db, beforeStatement) =>
          npWithAgentRuntimeControlTransactionV1(
            siteId,
            async () => {
              await beforeStatement();
              await authorize({ db, siteId });
              await npLockAgentSourceReleaseFenceV1(db, beforeStatement);
              await beforeStatement();
              await db.execute(sql`lock table np_settings in share mode nowait`);
              const result: NpAgentGuardianRetentionResultV1 = {
                examined: 0,
                eventsPruned: 0,
                receiptsPruned: 0,
                historyPruned: 0,
                closuresAdvanced: 0,
                nextCursor: null,
                skipped: [],
              };
              const skip = (reason: NpAgentGuardianRetentionSkipReasonV1) => {
                const item = result.skipped.find((s) => s.reason === reason);
                if (item) item.count++;
                else result.skipped.push({ reason, count: 1 });
              };
              const policyDigest = await npDigestAgentGuardianRetentionValueV1(
                  "np.agent-guardian-retention-policy.v1",
                  retention,
                ),
                closures = new Map<
                  NpAgentGuardianRetentionFamilyV1,
                  NpAgentGuardianSourceClosureV1
                >(),
                closureAudits = new Map<NpAgentGuardianRetentionFamilyV1, Audit>();
              async function closureAudit(closure: NpAgentGuardianSourceClosureV1): Promise<Audit> {
                const digest = await npDigestAgentGuardianRetentionValueV1(
                  "np.agent-guardian-source-closure.v1",
                  closure,
                );
                await beforeStatement();
                const rows = await db
                  .select()
                  .from(npAuditEvents)
                  .where(
                    and(
                      eq(npAuditEvents.siteId, siteId),
                      eq(npAuditEvents.action, "agent.guardian.source_closed"),
                      eq(npAuditEvents.targetType, "agent-guardian-source"),
                      eq(npAuditEvents.targetId, closure.family),
                      sql`${npAuditEvents.payload}->>'closureDigest'=${digest}`,
                    ),
                  )
                  .for("update", { noWait: true })
                  .limit(2);
                if (rows.length !== 1) invalid();
                const row = rows[0],
                  keys = ["closure", "closureDigest"],
                  body = canonicalBodyRecord(
                    cloneCanonicalRuntimeInput(
                      row.payload,
                      "guardian.retention.closureAudit",
                      4096,
                    ),
                    "guardian.retention.closureAudit",
                    keys,
                    keys,
                    { seen: new WeakSet() },
                  );
                if (
                  row.actorKind !== "system" ||
                  row.createdAt.toISOString() !== closure.closedAt ||
                  body.closureDigest !== digest ||
                  serializeAgentCanonicalJson(
                    npRequireAgentGuardianSourceClosureV1(body.closure),
                  ) !== serializeAgentCanonicalJson(closure)
                )
                  invalid();
                return row;
              }
              for (const family of owners.keys()) {
                await beforeStatement();
                const previous = await npReadAgentGuardianSourceClosureV1(db, siteId, family);
                if (previous && previous.closedBefore >= boundary) {
                  closures.set(family, previous);
                  closureAudits.set(family, await closureAudit(previous));
                  continue;
                }
                if (previous?.revision === 2147483647) invalid();
                const closure = npRequireAgentGuardianSourceClosureV1({
                  schemaVersion: "np.agent-guardian-source-closure.v1",
                  siteId,
                  family,
                  namespaceDigest: await npAgentGuardianSourceNamespaceDigestV1(family),
                  closedBefore: boundary,
                  closedAt: at.toISOString(),
                  revision: (previous?.revision ?? 0) + 1,
                  retentionPolicyDigest: policyDigest,
                });
                const closureDigest = await npDigestAgentGuardianRetentionValueV1(
                  "np.agent-guardian-source-closure.v1",
                  closure,
                );
                await beforeStatement();
                await db
                  .insert(npSettings)
                  .values({
                    siteId,
                    key: npAgentGuardianSourceClosureKeyV1(family),
                    value: closure,
                    updatedAt: at,
                    updatedBy: null,
                  })
                  .onConflictDoUpdate({
                    target: [npSettings.siteId, npSettings.key],
                    set: { value: closure, updatedAt: at, updatedBy: null },
                  });
                await beforeStatement();
                await db.insert(npAuditEvents).values({
                  siteId,
                  actorKind: "system",
                  actorUserId: null,
                  actorMemberId: null,
                  action: "agent.guardian.source_closed",
                  targetType: "agent-guardian-source",
                  targetId: family,
                  payload: { closure, closureDigest },
                  createdAt: at,
                });
                closures.set(family, closure);
                closureAudits.set(family, await closureAudit(closure));
                result.closuresAdvanced++;
              }
              await beforeStatement();
              const jobs = await db.execute(
                  sql`select to_regclass('pgboss.job') is not null as present`,
                ),
                hasJobs = jobs.rows[0]?.present === true;
              const pairs: SQL[] = [];
              for (const family of owners.keys())
                for (const [component, kind] of Object.entries(
                  npAgentGuardianSourcePairsV1[family],
                ))
                  pairs.push(sql`(t.source_component=${component} and t.kind=${kind})`);
              const supported = pairs.length ? sql.join(pairs, sql` or `) : sql`false`;
              const after = cursor === null ? sql`` : sql`and t.id>${cursor}::uuid`;
              await beforeStatement();
              const roots =
                await db.execute(sql`select id,array_agg(distinct kind order by kind) as kinds from (
        (select t.id,'event'::text as kind from np_agent_events t where t.site_id=${siteId} and (${supported}) and t.recorded_at<=${eventBefore} and t.occurred_at<${boundary}::timestamptz and t.dispatched_at is not null ${after} order by t.id limit ${limit})
        union all (select t.id,'receipt'::text as kind from np_agent_content_receipts t where t.site_id=${siteId} and t.state='sampled' and t.created_at<=${receiptBefore} and t.occurred_at<${boundary}::timestamptz ${after} order by t.id limit ${limit})
        union all (select t.id,'runtime-receipt'::text as kind from np_agent_runtime_receipts t where t.site_id=${siteId} and t.state='sampled' and t.created_at<=${receiptBefore} and t.occurred_at<${boundary}::timestamptz ${after} order by t.id limit ${limit})
        union all (select t.id,'history'::text as kind from np_agent_incidents t where t.site_id=${siteId} and t.status in ('resolved','dismissed') and t.resolved_at<=${historyBefore} and t.updated_at<=${historyBefore} and t.last_observed_at<=${historyBefore} and exists(select 1 from np_agent_signals s where s.site_id=t.site_id and s.incident_id=t.id and s.detector_id like 'guardian.%') ${after} order by t.id limit ${limit})
        union all (select t.id,'history'::text as kind from np_agent_signals t where t.site_id=${siteId} and t.incident_id is null and t.status in ('resolved','suppressed') and t.created_at<=${signalBefore} and t.updated_at<=${signalBefore} and t.window_ended_at<=${signalBefore} and t.expires_at<=${at} and t.detector_id like 'guardian.%' ${after} order by t.id limit ${limit})
      ) candidate group by id order by id limit ${limit}`);
              let proofFailure: NpAgentGuardianRetentionSkipReasonV1 | null;
              async function verifyEvent(row: Event): Promise<{
                family: NpAgentGuardianRetentionFamilyV1;
                proof: NpAgentGuardianVerifiedEventV1;
              } | null> {
                const family = familyOf(row),
                  owner = family ? owners.get(family) : undefined;
                if (!family || !owner) {
                  proofFailure = "UNSUPPORTED_SOURCE";
                  return null;
                }
                const closure = closures.get(family);
                if (!closure || row.occurredAt.toISOString() >= closure.closedBefore) {
                  proofFailure = "DELIVERY_NOT_CLOSED";
                  return null;
                }
                await beforeStatement();
                try {
                  const proof = npRequireAgentGuardianVerifiedEventV1(
                    await owner.verifyEvent({ db, siteId, eventId: row.id }),
                  );
                  if (
                    proof.eventId !== row.id ||
                    proof.source !== family ||
                    proof.observedAt !== row.occurredAt.toISOString() ||
                    proof.sourceDigest !== row.eventHash
                  )
                    invalid();
                  return { family, proof };
                } catch {
                  proofFailure = "PROOF_UNAVAILABLE";
                  return null;
                }
              }
              async function verifyGuardianSignal(args: {
                db: Db;
                siteId: string;
                signalId: string;
              }): Promise<boolean> {
                if (args.db !== db || args.siteId !== siteId) return false;
                await beforeStatement();
                const [signal] = await db
                  .select()
                  .from(npAgentSignals)
                  .where(
                    and(eq(npAgentSignals.siteId, siteId), eq(npAgentSignals.id, args.signalId)),
                  )
                  .limit(1);
                const detector = signal
                  ? npAgentGuardianOperationsDetectorsV1.find(
                      (d) => d.id === signal.detectorId && d.version === signal.detectorVersion,
                    )
                  : undefined;
                if (!signal || !detector) {
                  proofFailure = "UNSUPPORTED_SOURCE";
                  return false;
                }
                const ruleOwner = owners.get(detector.source);
                if (!ruleOwner?.verifySignal) {
                  proofFailure = "PROOF_UNAVAILABLE";
                  return false;
                }
                await beforeStatement();
                try {
                  if (
                    (await ruleOwner.verifySignal({ db, siteId, signalId: signal.id })) !== true
                  ) {
                    proofFailure = "PROOF_UNAVAILABLE";
                    return false;
                  }
                } catch {
                  proofFailure = "PROOF_UNAVAILABLE";
                  return false;
                }
                const category =
                  detector.id === "guardian.rate-limits" || detector.source === "http"
                    ? "traffic"
                    : detector.id === "guardian.authority-escalated"
                      ? "authorization"
                      : detector.id === "guardian.policy-activated"
                        ? "agent-abuse"
                        : detector.source === "runtime"
                          ? "agent-abuse"
                          : detector.id === "guardian.plugin-changed"
                            ? "integrity"
                            : detector.source === "content"
                              ? "integrity"
                              : detector.source === "sentry"
                                ? "availability"
                                : "authentication";
                if (
                  signal.category !== category ||
                  signal.confidenceBasis !==
                    (detector.source === "sentry" ? "external" : "exact-rule") ||
                  signal.scoreBasisPoints !== null
                ) {
                  proofFailure = "PROOF_UNAVAILABLE";
                  return false;
                }
                try {
                  const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
                  if (canonical.evidence.some((r) => r.kind !== "event")) {
                    proofFailure = "UNSUPPORTED_SOURCE";
                    return false;
                  }
                  const refs = canonical.evidence.filter((r) => r.kind === "event"),
                    ids = [...new Set(refs.map((r) => r.eventId))],
                    count =
                      detector.id === "guardian.login-after-failures"
                        ? 6
                        : detector.id === "guardian.login-failures" ||
                            detector.id === "guardian.rate-limits" ||
                            detector.id === "guardian.content-churn" ||
                            detector.source === "http" ||
                            detector.id === "guardian.denied-scopes" ||
                            detector.id === "guardian.action-velocity"
                          ? 5
                          : detector.id === "guardian.revision-volume"
                            ? 20
                            : 1;
                  if (
                    refs.length !== ids.length ||
                    (detector.id === "guardian.spend-velocity"
                      ? ids.length < 1 || ids.length > 100
                      : ids.length !== count)
                  )
                    return false;
                  await beforeStatement();
                  const rows = await npReadAgentEventRowsV1(db, siteId, ids);
                  if (rows.length !== ids.length) return false;
                  for (const row of rows) {
                    const event = await npReadAgentEventRowEvidenceV1(row),
                      hex = Buffer.from(
                        row.eventHash.slice("cj1:sha256:".length),
                        "base64url",
                      ).toString("hex"),
                      verified = await verifyEvent(row);
                    if (
                      !verified ||
                      verified.family !== detector.source ||
                      ((detector.source === "security-transitions" ||
                        detector.source === "sentry") &&
                        verified.proof.detectorId !== detector.id) ||
                      event.occurredAt < canonical.window.startedAt ||
                      event.occurredAt > canonical.window.endedAt ||
                      refs.some(
                        (r) =>
                          r.eventId === row.id &&
                          (r.eventKind !== event.kind ||
                            r.observedAt !== event.occurredAt ||
                            r.digest !== hex),
                      )
                    )
                      return false;
                    if (detector.source === "runtime") {
                      if (
                        event.subject?.kind !== "agent" ||
                        canonical.subject?.kind !== "agent" ||
                        event.subject.agentId !== canonical.subject.agentId ||
                        canonical.subject.agentVersionId !== null
                      )
                        return false;
                    } else if (detector.id === "guardian.login-failures") {
                      // The failure Event subject is the login-identifier bucket;
                      // the exact five-fact rule groups its network actor instead.
                      if (
                        event.payload.kind !== "auth.login.failed" ||
                        serializeAgentCanonicalJson(canonical.subject) !==
                          serializeAgentCanonicalJson({
                            kind: "actor-bucket",
                            ...event.payload.ipBucket,
                          })
                      )
                        return false;
                    } else if (
                      detector.id !== "guardian.login-after-failures" ||
                      event.kind === "auth.login.succeeded"
                    )
                      if (
                        serializeAgentCanonicalJson(event.subject) !==
                        serializeAgentCanonicalJson(canonical.subject)
                      )
                        return false;
                  }
                  return true;
                } catch {
                  proofFailure = "PROOF_UNAVAILABLE";
                  return false;
                }
              }
              async function clear(
                targets: readonly string[],
                excluded: readonly { table: string; id: string }[],
              ): Promise<boolean> {
                const matches = (alias: string) =>
                  sql.join(
                    targets.map(
                      (id) => sql`position(${id} in to_jsonb(${sql.identifier(alias)})::text)>0`,
                    ),
                    sql` or `,
                  );
                const checks = [
                  ...new Set([...npAgentSiteOwnedTableNamesV1, "np_agent_site_deletion_sagas"]),
                ].map((table) => {
                  const own = excluded.filter((e) => e.table === table).map((e) => e.id);
                  const reference =
                    table === "np_agent_content_receipts"
                      ? sql.join(
                          targets.map((id) => sql`dependency.emitted_event_id::text=${id}`),
                          sql` or `,
                        )
                      : matches("dependency");
                  return sql`not exists(select 1 from ${sql.identifier(table)} dependency where (${reference}) ${
                    own.length
                      ? sql`and dependency.id not in (${sql.join(
                          own.map((id) => sql`${id}::uuid`),
                          sql`,`,
                        )})`
                      : sql``
                  })`;
                });
                const audits = excluded
                  .filter((e) => e.table === "np_audit_events")
                  .map((e) => e.id);
                checks.push(
                  sql`not exists(select 1 from np_audit_events dependency where (${matches("dependency")}) ${
                    audits.length
                      ? sql`and dependency.id not in (${sql.join(
                          audits.map((id) => sql`${id}::uuid`),
                          sql`,`,
                        )})`
                      : sql``
                  })`,
                );
                checks.push(
                  sql`not exists(select 1 from np_settings dependency where (${matches("dependency")}))`,
                );
                if (hasJobs)
                  checks.push(
                    sql`not exists(select 1 from pgboss.job dependency where dependency.state::text in ('created','retry','active') and (${sql.join(
                      targets.map((id) => sql`position(${id} in dependency.data::text)>0`),
                      sql` or `,
                    )}))`,
                  );
                await beforeStatement();
                const read = await db.execute(
                  sql`select (${sql.join(checks, sql` and `)}) as clear`,
                );
                return read.rows[0]?.clear === true;
              }
              async function receiptProof(
                row: Receipt,
                family: ReceiptFamily,
              ): Promise<NpAgentGuardianRetentionReceiptProofV1 | null> {
                const owner = owners.get(family);
                if (!owner?.verifyReceipt) return null;
                await beforeStatement();
                try {
                  const value = await owner.verifyReceipt({ db, siteId, receiptId: row.id }),
                    keys = ["sourceProofDigest", "occurredAt", "state", "emittedEventId"],
                    raw = canonicalBodyRecord(
                      cloneCanonicalRuntimeInput(value, "guardian.retention.receipt", 2048),
                      "guardian.retention.receipt",
                      keys,
                      keys,
                      { seen: new WeakSet() },
                    );
                  const sourceProofDigest = canonicalBodySha256Digest(
                      raw.sourceProofDigest,
                      "guardian.retention.receipt",
                    ),
                    occurredAt = canonicalBodyUtc(raw.occurredAt, "guardian.retention.receipt"),
                    emittedEventId = raw.emittedEventId === null ? null : uuid(raw.emittedEventId);
                  if (
                    sourceProofDigest !== row.bodyHash ||
                    occurredAt !== row.occurredAt.toISOString() ||
                    raw.state !== row.state ||
                    emittedEventId !== row.emittedEventId ||
                    !["emitted", "sampled"].includes(row.state)
                  )
                    return null;
                  return {
                    sourceProofDigest,
                    occurredAt,
                    state: row.state === "emitted" ? "emitted" : "sampled",
                    emittedEventId,
                  };
                } catch {
                  return null;
                }
              }
              async function releasableRuntimeReceipt(id: string): Promise<boolean> {
                await beforeStatement();
                const result =
                  await db.execute(sql`select exists(select 1 from np_agent_runtime_receipts receipt
                  join np_agent_runs parent on parent.site_id=receipt.site_id and parent.id=receipt.run_id
                  where receipt.site_id=${siteId} and receipt.id=${id}::uuid
                    and parent.state in ('succeeded','failed','cancelled','policy_blocked','budget_blocked')
                    and parent.finished_at is not null and parent.finished_at<=${receiptBefore}
                    and parent.lease_until is null and parent.runtime_retry_at is null
                    and not exists(select 1 from np_agent_provider_calls c where c.site_id=parent.site_id and c.run_id=parent.id and
                      (c.state not in ('succeeded','failed','cancelled') or c.dispatch_state not in ('dispatched','not-dispatched')
                        or c.usage_source='unknown' or c.cost_source='unknown'))
                    and not exists(select 1 from np_agent_usage_reservations r where r.site_id=parent.site_id and r.run_id=parent.id and
                      (r.state not in ('reconciled','released') or r.unpriced or r.actual_usage_source='unknown' or r.actual_cost_source='unknown'))
                    and not exists(select 1 from np_agent_actions a where a.site_id=parent.site_id and a.run_id=parent.id
                      and a.state not in ('policy_blocked','succeeded','failed','compensated'))
                ) as eligible`);
                return result.rows[0]?.eligible === true;
              }
              for (const root of roots.rows) {
                const id = uuid(root.id);
                if (
                  !Array.isArray(root.kinds) ||
                  root.kinds.some(
                    (kind) =>
                      !["event", "receipt", "runtime-receipt", "history"].includes(String(kind)),
                  )
                )
                  invalid();
                result.examined++;
                result.nextCursor = id;
                if (root.kinds.includes("history")) {
                  proofFailure = null;
                  const history = await npPruneAgentIncidentRetentionV1({
                    db,
                    siteId,
                    cursor: null,
                    limit: 1,
                    rootIds: [id],
                    now: at,
                    policy: {
                      signalDays: retention.signalDays,
                      historyDays: retention.historyDays,
                    },
                    beforeStatement,
                    maximumRows: 1000,
                    verifyGuardianSignal,
                  });
                  result.historyPruned += history.pruned;
                  if (!history.pruned) skip(proofFailure ?? "COHORT_PINNED");
                }
                if (root.kinds.includes("event")) {
                  await beforeStatement();
                  const [row] = await db
                    .select()
                    .from(npAgentEvents)
                    .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, id)))
                    .for("update", { noWait: true })
                    .limit(1);
                  if (!row) continue;
                  if (
                    row.recordedAt > eventBefore ||
                    row.occurredAt.toISOString() >= boundary ||
                    !row.dispatchedAt
                  ) {
                    skip("NOT_ELIGIBLE");
                    continue;
                  }
                  proofFailure = null;
                  const verified = await verifyEvent(row);
                  if (!verified) {
                    skip(proofFailure ?? "PROOF_UNAVAILABLE");
                    continue;
                  }
                  const event = await npReadAgentEventRowEvidenceV1(row),
                    family = verified.family,
                    closure = closures.get(family),
                    closedAudit = closureAudits.get(family);
                  if (!closure || !closedAudit) invalid();
                  let audit: Audit | null = null,
                    receipt: Receipt | null = null,
                    receiptFamily: ReceiptFamily | null = null,
                    receiptDigest: string | null = null,
                    eligibleAt = new Date(row.recordedAt.getTime() + retention.eventDays * DAY);
                  if (family === "requests") {
                    // The request envelope remains byte-compatible; its independent
                    // source-only receipt is located by the exact owning Event.
                    await beforeStatement();
                    const entries = await db
                      .select()
                      .from(npAuditEvents)
                      .where(
                        and(
                          eq(npAuditEvents.siteId, siteId),
                          eq(npAuditEvents.targetType, "agent-event"),
                          eq(npAuditEvents.targetId, row.id),
                          eq(npAuditEvents.action, "agent.guardian_request.source"),
                        ),
                      )
                      .for("update", { noWait: true })
                      .limit(2);
                    if (entries.length !== 1) {
                      skip("PROOF_UNAVAILABLE");
                      continue;
                    }
                    audit = entries[0];
                    eligibleAt = new Date(
                      Math.max(
                        eligibleAt.getTime(),
                        audit.createdAt.getTime() + retention.receiptDays * DAY,
                      ),
                    );
                  } else if (
                    family === "security-transitions" ||
                    family === "sentry" ||
                    family === "http"
                  ) {
                    const auditId =
                      family === "security-transitions"
                        ? npRequireAgentSecurityTransitionPayloadV1(event.payload).sourceReceiptId
                        : family === "http" && event.payload.kind === "http.response.observed"
                          ? event.payload.receiptId
                          : event.correlationId;
                    if (!auditId) {
                      skip("PROOF_UNAVAILABLE");
                      continue;
                    }
                    await beforeStatement();
                    const [entry] = await db
                      .select()
                      .from(npAuditEvents)
                      .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.id, auditId)))
                      .for("update", { noWait: true })
                      .limit(1);
                    if (
                      !entry ||
                      entry.targetType !== "agent-event" ||
                      entry.targetId !== row.id ||
                      entry.action !==
                        (family === "sentry"
                          ? "agent.guardian_external.source"
                          : family === "http"
                            ? "agent.guardian_http.source"
                            : "agent.guardian_security.source")
                    ) {
                      skip("PROOF_UNAVAILABLE");
                      continue;
                    }
                    audit = entry;
                    eligibleAt = new Date(
                      Math.max(
                        eligibleAt.getTime(),
                        entry.createdAt.getTime() + retention.receiptDays * DAY,
                      ),
                    );
                  } else if (family === "content" || family === "runtime") {
                    if (
                      (family === "content" &&
                        event.payload.kind !== "content.activity.observed") ||
                      (family === "runtime" &&
                        event.payload.kind !== "agent.runtime.activity.observed") ||
                      !("receiptId" in event.payload)
                    ) {
                      skip("PROOF_UNAVAILABLE");
                      continue;
                    }
                    await beforeStatement();
                    const table = receiptTables[family];
                    const [entry] = await db
                      .select()
                      .from(table)
                      .where(and(eq(table.siteId, siteId), eq(table.id, event.payload.receiptId)))
                      .for("update", { noWait: true })
                      .limit(1);
                    if (!entry || entry.state !== "emitted" || entry.emittedEventId !== row.id) {
                      skip("PROOF_UNAVAILABLE");
                      continue;
                    }
                    const proof = await receiptProof(entry, family);
                    if (!proof) {
                      skip("PROOF_UNAVAILABLE");
                      continue;
                    }
                    if (family === "runtime" && !(await releasableRuntimeReceipt(entry.id))) {
                      skip("COHORT_PINNED");
                      continue;
                    }
                    receipt = entry;
                    receiptFamily = family;
                    receiptDigest = proof.sourceProofDigest;
                    eligibleAt = new Date(
                      Math.max(
                        eligibleAt.getTime(),
                        entry.createdAt.getTime() + retention.receiptDays * DAY,
                      ),
                    );
                  }
                  if (eligibleAt > at) {
                    skip("NOT_ELIGIBLE");
                    continue;
                  }
                  const deliveryKeyDigest = await npAgentGuardianSourceDeliveryKeyDigestV1(event);
                  await beforeStatement();
                  const [existing] = await db
                    .select({ id: npAgentSourceReleases.id })
                    .from(npAgentSourceReleases)
                    .where(
                      and(
                        eq(npAgentSourceReleases.siteId, siteId),
                        eq(npAgentSourceReleases.sourceKind, "guardian-event"),
                        or(
                          eq(npAgentSourceReleases.sourceId, id),
                          sql`${npAgentSourceReleases.evidenceBody}->>'deliveryKeyDigest'=${deliveryKeyDigest}`,
                        ),
                      ),
                    )
                    .limit(1);
                  if (existing) {
                    skip("RELEASE_CONFLICT");
                    continue;
                  }
                  const targets = [id, ...(receipt ? [receipt.id] : [])],
                    excluded = [
                      { table: "np_agent_events", id },
                      ...(audit ? [{ table: "np_audit_events", id: audit.id }] : []),
                      ...(receipt && receiptFamily
                        ? [{ table: receiptTableName(receiptFamily), id: receipt.id }]
                        : []),
                    ];
                  if (!(await clear(targets, excluded))) {
                    skip("REFERENCE_PINNED");
                    continue;
                  }
                  const auditDigest = audit ? npGuardianRetentionAuditOwnerDigestV1(audit) : null,
                    body = npRequireAgentSourceReleaseV1({
                      schemaVersion: "np.agent-source-release.v1",
                      verifierVersion: 1,
                      kind: "guardian-event",
                      siteId,
                      sourceId: id,
                      releasedAt: at.toISOString(),
                      family,
                      eventKind: event.kind,
                      sourceComponent: event.source.component,
                      namespaceDigest: closure.namespaceDigest,
                      deliveryKeyDigest,
                      eventHash: row.eventHash,
                      sourceProofDigest: await npGuardianRetentionSourceProofDigestV1({
                        event: verified.proof,
                        auditDigest,
                        receiptDigest,
                      }),
                      closureDigest: await npDigestAgentGuardianRetentionValueV1(
                        "np.agent-guardian-source-closure.v1",
                        closure,
                      ),
                      closedBefore: closure.closedBefore,
                      occurredAt: event.occurredAt,
                      recordedAt: row.recordedAt.toISOString(),
                      retentionEligibleAt: eligibleAt.toISOString(),
                    });
                  const releaseId = randomUUID();
                  await beforeStatement();
                  await db.insert(npAgentSourceReleases).values({
                    id: releaseId,
                    siteId,
                    sourceKind: "guardian-event",
                    sourceId: id,
                    evidenceBody: body,
                    evidenceDigest: await npDigestAgentSourceReleaseV1(body),
                    principalId: null,
                    admissionKeyDigest: null,
                    releasedAt: at,
                  });
                  excluded.push({ table: "np_agent_source_releases", id: releaseId });
                  if (audit && auditDigest) {
                    const edgeId = randomUUID();
                    await beforeStatement();
                    await db.insert(npAgentSourceReleaseEdges).values({
                      id: edgeId,
                      siteId,
                      sourceReleaseId: releaseId,
                      ownerKind: "guardian-audit",
                      ownerId: audit.id,
                      edgeCode: "guardian-event",
                      ownerEvidenceDigest: auditDigest,
                      verifierVersion: 1,
                      releasedAt: at,
                    });
                    excluded.push({ table: "np_agent_source_release_edges", id: edgeId });
                  }
                  const closureEdgeId = randomUUID();
                  await beforeStatement();
                  await db.insert(npAgentSourceReleaseEdges).values({
                    id: closureEdgeId,
                    siteId,
                    sourceReleaseId: releaseId,
                    ownerKind: "guardian-closure-audit",
                    ownerId: closedAudit.id,
                    edgeCode: "guardian-closure",
                    ownerEvidenceDigest: npGuardianRetentionAuditOwnerDigestV1(closedAudit),
                    verifierVersion: 1,
                    releasedAt: at,
                  });
                  excluded.push({ table: "np_agent_source_release_edges", id: closureEdgeId });
                  if (!(await clear(targets, excluded))) invalid();
                  if (receipt && receiptFamily) {
                    const table = receiptTables[receiptFamily];
                    await beforeStatement();
                    const removed = await db
                      .delete(table)
                      .where(
                        and(
                          eq(table.siteId, siteId),
                          eq(table.id, receipt.id),
                          eq(table.state, "emitted"),
                          eq(table.emittedEventId, id),
                        ),
                      )
                      .returning({ id: table.id });
                    if (removed.length !== 1) invalid();
                    result.receiptsPruned++;
                  }
                  await beforeStatement();
                  const removed = await db
                    .delete(npAgentEvents)
                    .where(
                      and(
                        eq(npAgentEvents.siteId, siteId),
                        eq(npAgentEvents.id, id),
                        eq(npAgentEvents.eventHash, row.eventHash),
                      ),
                    )
                    .returning({ id: npAgentEvents.id });
                  if (removed.length !== 1) invalid();
                  result.eventsPruned++;
                }
                for (const family of ["content", "runtime"] as const) {
                  if (!root.kinds.includes(family === "content" ? "receipt" : "runtime-receipt"))
                    continue;
                  const table = receiptTables[family],
                    closure = closures.get(family);
                  if (!closure) {
                    skip("DELIVERY_NOT_CLOSED");
                    continue;
                  }
                  await beforeStatement();
                  const [row] = await db
                    .select()
                    .from(table)
                    .where(and(eq(table.siteId, siteId), eq(table.id, id)))
                    .for("update", { noWait: true })
                    .limit(1);
                  if (!row) continue;
                  if (
                    row.state !== "sampled" ||
                    row.emittedEventId !== null ||
                    row.createdAt > receiptBefore ||
                    row.occurredAt.toISOString() >= closure.closedBefore
                  ) {
                    skip("NOT_ELIGIBLE");
                    continue;
                  }
                  if (!(await receiptProof(row, family))) {
                    skip("PROOF_UNAVAILABLE");
                    continue;
                  }
                  if (family === "runtime" && !(await releasableRuntimeReceipt(id))) {
                    skip("COHORT_PINNED");
                    continue;
                  }
                  if (!(await clear([id], [{ table: receiptTableName(family), id }]))) {
                    skip("REFERENCE_PINNED");
                    continue;
                  }
                  await beforeStatement();
                  const removed = await db
                    .delete(table)
                    .where(
                      and(
                        eq(table.siteId, siteId),
                        eq(table.id, id),
                        eq(table.state, "sampled"),
                        eq(table.bodyHash, row.bodyHash),
                      ),
                    )
                    .returning({ id: table.id });
                  if (removed.length !== 1) invalid();
                  result.receiptsPruned++;
                }
              }
              if (roots.rows.length < limit) result.nextCursor = null;
              await beforeStatement();
              await authorize({ db, siteId });
              return result;
            },
            db,
          ),
        );
      } catch (error) {
        if (error instanceof NpAgentGatewayError) throw error;
        throw new NpAgentGatewayError(
          "GUARDIAN_RETENTION_UNAVAILABLE",
          503,
          "Guardian retained evidence is unavailable.",
        );
      }
    },
  };
}
