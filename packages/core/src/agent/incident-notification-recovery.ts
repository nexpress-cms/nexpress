import { createHash } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentIncidents, npAgentIncidentTimeline } from "../db/schema/agent.js";
import { npSettings } from "../db/schema/system.js";
import {
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUuid,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUtc,
  canonicalBodySha256Digest,
} from "../agent-contract/canonical-body-validation.js";
import { NpAgentContractError } from "../agent-contract/contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentIncidentNotificationRecoveryV1,
  type NpAgentIncidentNotificationRecoveryV1,
} from "../agent-contract/incident-notification-recovery-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npRequireIncidentContainmentFailure } from "./incident-containment-failure.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { NpAgentIncidentNotificationRecordInputV1 } from "./incident-notifications-service.js";

type Db = ReturnType<typeof getDb>;
type Entry = typeof npAgentIncidentTimeline.$inferSelect;
export const NP_INCIDENT_NOTIFICATION_RECOVERY_SCHEMA =
  "np.agent-incident-notification-recovery-entry.v1";
const SOURCE_SCHEMA = "np.agent-incident-notification-recovery-source.v1";
const CURSOR_KEY = "np.agent.incident-notification-recovery.cursor.v1";
const DELAYS = [30000, 120000, 600000, 1800000];
const BATCH = 25;
type Recovery = NpAgentIncidentNotificationRecoveryV1;
interface Source {
  schemaVersion: typeof SOURCE_SCHEMA;
  siteId: string;
  incidentId: string;
  timelineId: string;
  transitionVersion: number;
  severity: "high" | "critical";
  status: "open" | "investigating" | "contained" | "monitoring" | "resolved" | "dismissed";
  actionId: string;
  auditEventId: string;
  executionInvocationId: string;
  sourceFingerprint: string;
  observedAt: string;
}
function fail(): never {
  throw new NpAgentGatewayError(
    "INCIDENT_NOTIFICATION_RECOVERY_INVALID",
    409,
    "Notification recovery is unavailable.",
  );
}
function evidenceError(error: unknown): boolean {
  return (
    error instanceof NpAgentContractError ||
    (error instanceof NpAgentGatewayError && [404, 409].includes(error.status))
  );
}
function parseSource(value: unknown): Source {
  const p = "notification.recovery.source";
  const keys = [
    "schemaVersion",
    "siteId",
    "incidentId",
    "timelineId",
    "transitionVersion",
    "severity",
    "status",
    "actionId",
    "auditEventId",
    "executionInvocationId",
    "sourceFingerprint",
    "observedAt",
  ];
  const r = canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet() });
  if (r.schemaVersion !== SOURCE_SCHEMA) fail();
  return {
    schemaVersion: SOURCE_SCHEMA,
    siteId: canonicalBodySiteId(r.siteId, p),
    incidentId: canonicalBodyUuid(r.incidentId, p),
    timelineId: canonicalBodyUuid(r.timelineId, p),
    transitionVersion: canonicalBodyInteger(r.transitionVersion, p, 2, 2147483647),
    severity: canonicalBodyEnum<Source["severity"]>(r.severity, p, new Set(["high", "critical"])),
    status: canonicalBodyEnum<Source["status"]>(
      r.status,
      p,
      new Set(["open", "investigating", "contained", "monitoring", "resolved", "dismissed"]),
    ),
    actionId: canonicalBodyUuid(r.actionId, p),
    auditEventId: canonicalBodyUuid(r.auditEventId, p),
    executionInvocationId: canonicalBodyUuid(r.executionInvocationId, p),
    sourceFingerprint: canonicalBodySha256Digest(r.sourceFingerprint, p),
    observedAt: canonicalBodyUtc(r.observedAt, p),
  };
}
const digest = (source: Source) =>
  `cj1:sha256:${createHash("sha256")
    .update(SOURCE_SCHEMA + "\0")
    .update(serializeAgentCanonicalJson(source))
    .digest("base64url")}`;
/** Frozen source facts never inherit a later Incident severity/status/version. */
export async function npRequireIncidentNotificationRecoverySource(
  db: Db,
  entry: Entry,
): Promise<Source> {
  if (
    entry.kind !== "action" ||
    entry.sourceKind !== "system" ||
    !entry.actionId ||
    !entry.auditEventId ||
    entry.details.schemaVersion !== "np.agent-incident-containment-failure-entry.v1" ||
    entry.details.notificationRecoveryRequested !== true ||
    entry.details.phase !== "failed" ||
    entry.details.outcome !== "rolled_back"
  )
    fail();
  const source = parseSource({
    schemaVersion: SOURCE_SCHEMA,
    siteId: entry.siteId,
    incidentId: entry.incidentId,
    timelineId: entry.id,
    transitionVersion: entry.details.transitionVersion,
    severity: entry.details.severity,
    status: entry.details.status,
    actionId: entry.actionId,
    auditEventId: entry.auditEventId,
    executionInvocationId: entry.details.executionInvocationId,
    sourceFingerprint: entry.sourceFingerprint,
    observedAt: entry.createdAt.toISOString(),
  });
  const proof = await npRequireIncidentContainmentFailure({ db, ...source });
  if (
    proof.action.inputHash !== source.sourceFingerprint ||
    proof.execution.id !== source.executionInvocationId
  )
    fail();
  const [incident] = await db
    .select({ version: npAgentIncidents.versionNumber })
    .from(npAgentIncidents)
    .where(
      and(eq(npAgentIncidents.siteId, source.siteId), eq(npAgentIncidents.id, source.incidentId)),
    )
    .limit(1);
  if (!incident || incident.version < source.transitionVersion) fail();
  return source;
}
async function journal(
  db: Db,
  entry: Entry,
): Promise<{ source: Source; recovery: Recovery } | null> {
  const rows = await db
    .select()
    .from(npAgentIncidentTimeline)
    .where(
      and(
        eq(npAgentIncidentTimeline.siteId, entry.siteId),
        eq(npAgentIncidentTimeline.incidentId, entry.incidentId),
        eq(npAgentIncidentTimeline.sourceId, entry.id),
        sql`${npAgentIncidentTimeline.details}->>'schemaVersion' = ${NP_INCIDENT_NOTIFICATION_RECOVERY_SCHEMA}`,
      ),
    )
    .orderBy(asc(npAgentIncidentTimeline.sequence))
    .limit(7);
  if (!rows.length) return null;
  if (rows.length > 6) fail();
  let source: Source | undefined;
  let previous: Recovery | undefined;
  let previousAt = entry.createdAt.toISOString();
  for (const [index, row] of rows.entries()) {
    const keys = ["schemaVersion", "source", "recovery"];
    const details = canonicalBodyRecord(row.details, "notification.recovery", keys, keys, {
      seen: new WeakSet(),
    });
    const frozen = parseSource(details.source);
    const recovery = npRequireAgentIncidentNotificationRecoveryV1(details.recovery);
    const at = row.createdAt.toISOString();
    if (
      row.kind !== "notification" ||
      row.sourceKind !== "system" ||
      row.sequence <= entry.sequence ||
      frozen.siteId !== entry.siteId ||
      frozen.incidentId !== entry.incidentId ||
      frozen.timelineId !== entry.id ||
      row.actionId !== frozen.actionId ||
      row.auditEventId !== frozen.auditEventId ||
      row.sourceFingerprint !== digest(frozen) ||
      (source && serializeAgentCanonicalJson(source) !== serializeAgentCanonicalJson(frozen)) ||
      recovery.attempts !== index ||
      at < previousAt ||
      (index === 0
        ? recovery.state !== "pending" || recovery.nextAttemptAt !== at
        : !previous ||
          previous.state !== "pending" ||
          !previous.nextAttemptAt ||
          at < previous.nextAttemptAt ||
          recovery.lastAttemptAt !== at) ||
      (recovery.state === "pending" &&
        index > 0 &&
        recovery.nextAttemptAt !== new Date(Date.parse(at) + DELAYS[index - 1]).toISOString())
    )
      fail();
    source = frozen;
    previous = recovery;
    previousAt = at;
  }
  if (!source || !previous) return fail();
  return { source, recovery: previous };
}
async function append(db: Db, source: Source, recovery: Recovery, at: Date): Promise<void> {
  npRequireAgentIncidentNotificationRecoveryV1(recovery);
  const [last] = await db
    .select({ maximum: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)` })
    .from(npAgentIncidentTimeline)
    .where(
      and(
        eq(npAgentIncidentTimeline.siteId, source.siteId),
        eq(npAgentIncidentTimeline.incidentId, source.incidentId),
      ),
    );
  const sequence = Number(last?.maximum ?? 0) + 1;
  canonicalBodyInteger(sequence, "notification.recovery.sequence", 1, 2147483647);
  await db.insert(npAgentIncidentTimeline).values({
    siteId: source.siteId,
    incidentId: source.incidentId,
    sequence,
    kind: "notification",
    sourceKind: "system",
    sourceId: source.timelineId,
    sourceFingerprint: digest(source),
    actionId: source.actionId,
    auditEventId: source.auditEventId,
    summary: "Local Admin notification recording recovery.",
    details: {
      schemaVersion: NP_INCIDENT_NOTIFICATION_RECOVERY_SCHEMA,
      source: { ...source },
      recovery: { ...recovery },
    },
    createdAt: at,
  });
}
/** Append-only local recording journal. Called only by explicitly installed host owners. */
export function npCreateIncidentNotificationRecovery(options: {
  now: () => Date;
  record(input: NpAgentIncidentNotificationRecordInputV1): Promise<void>;
  receipt(input: NpAgentIncidentNotificationRecordInputV1): Promise<boolean>;
}) {
  const inputFor = (db: Db, source: Source): NpAgentIncidentNotificationRecordInputV1 => ({
    db,
    siteId: source.siteId,
    incidentId: source.incidentId,
    timelineId: source.timelineId,
    transitionVersion: source.transitionVersion,
    transition: "containment_failed",
  });
  async function attempt(
    db: Db,
    entry: Entry,
    current: { source: Source; recovery: Recovery },
  ): Promise<void> {
    const at = options.now();
    if (
      current.recovery.state !== "pending" ||
      !current.recovery.nextAttemptAt ||
      at.toISOString() < current.recovery.nextAttemptAt
    )
      return;
    const attempts = current.recovery.attempts + 1;
    let valid = true;
    try {
      const source = await npRequireIncidentNotificationRecoverySource(db, entry);
      if (serializeAgentCanonicalJson(source) !== serializeAgentCanonicalJson(current.source))
        fail();
    } catch (error) {
      if (!evidenceError(error)) throw error;
      valid = false;
    }
    if (!valid) {
      await append(
        db,
        current.source,
        {
          state: "failed",
          attempts,
          lastAttemptAt: at.toISOString(),
          nextAttemptAt: null,
          lastErrorCode: "SOURCE_EVIDENCE_INVALID",
        },
        at,
      );
      return;
    }
    try {
      // Receipt and sent evidence commit together; a failure leaves neither behind.
      await db.transaction(async (tx) => {
        await options.record(inputFor(tx, current.source));
        if (!(await options.receipt(inputFor(tx, current.source)))) fail();
        await append(
          tx,
          current.source,
          {
            state: "sent",
            attempts,
            lastAttemptAt: at.toISOString(),
            nextAttemptAt: null,
            lastErrorCode: null,
          },
          at,
        );
      });
    } catch {
      await append(
        db,
        current.source,
        {
          state: attempts === 5 ? "failed" : "pending",
          attempts,
          lastAttemptAt: at.toISOString(),
          nextAttemptAt:
            attempts === 5 ? null : new Date(at.getTime() + DELAYS[attempts - 1]).toISOString(),
          lastErrorCode: "NOTIFICATION_RECORDING_FAILED",
        },
        at,
      );
    }
  }
  return {
    async recordFailure(input: NpAgentIncidentNotificationRecordInputV1): Promise<void> {
      npAssertAgentPreviewEffectsAllowed();
      if (input.transition !== "containment_failed") fail();
      canonicalBodyUuid(input.incidentId, "notification.recovery.incidentId");
      canonicalBodyUuid(input.timelineId, "notification.recovery.timelineId");
      canonicalBodyInteger(input.transitionVersion, "notification.recovery.version", 2, 2147483647);
      await npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ db }) => {
          const [incident] = await db
            .select()
            .from(npAgentIncidents)
            .where(
              and(
                eq(npAgentIncidents.siteId, input.siteId),
                eq(npAgentIncidents.id, input.incidentId),
              ),
            )
            .for("update")
            .limit(1);
          const [entry] = await db
            .select()
            .from(npAgentIncidentTimeline)
            .where(
              and(
                eq(npAgentIncidentTimeline.siteId, input.siteId),
                eq(npAgentIncidentTimeline.incidentId, input.incidentId),
                eq(npAgentIncidentTimeline.id, input.timelineId),
              ),
            )
            .limit(1);
          if (
            !incident ||
            !entry ||
            incident.versionNumber !== input.transitionVersion ||
            entry.details.transitionVersion !== input.transitionVersion
          )
            fail();
          const source = await npRequireIncidentNotificationRecoverySource(db, entry);
          if (source.severity !== incident.severity || source.status !== incident.status) fail();
          if (await journal(db, entry)) return; // An exact owner replay never resets the retry budget.
          const at = options.now();
          if (at < entry.createdAt) fail();
          const recovery: Recovery = {
            state: "pending",
            attempts: 0,
            lastAttemptAt: null,
            nextAttemptAt: at.toISOString(),
            lastErrorCode: null,
          };
          await append(db, source, recovery, at);
          await attempt(db, entry, { source, recovery });
        },
        input.db,
      );
    },
    async recover(input: { siteId: string }): Promise<void> {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodySiteId(input.siteId, "notification.recovery.siteId");
      await npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) => {
        const [cursor] = await db
          .select()
          .from(npSettings)
          .where(and(eq(npSettings.siteId, input.siteId), eq(npSettings.key, CURSOR_KEY)))
          .limit(1);
        let after: string | null = null;
        if (cursor) {
          const keys = ["schemaVersion", "afterTimelineId"];
          const value = canonicalBodyRecord(
            cursor.value,
            "notification.recovery.cursor",
            keys,
            keys,
            { seen: new WeakSet() },
          );
          if (value.schemaVersion !== "np.agent-incident-notification-recovery-cursor.v1") fail();
          after =
            value.afterTimelineId === null
              ? null
              : canonicalBodyUuid(value.afterTimelineId, "notification.recovery.cursor");
        }
        const entries = await db
          .select()
          .from(npAgentIncidentTimeline)
          .where(
            and(
              eq(npAgentIncidentTimeline.siteId, input.siteId),
              eq(npAgentIncidentTimeline.kind, "action"),
              sql`${npAgentIncidentTimeline.details}->>'schemaVersion' = 'np.agent-incident-containment-failure-entry.v1'`,
              sql`${npAgentIncidentTimeline.details}->'notificationRecoveryRequested' = 'true'::jsonb`,
              after ? gt(npAgentIncidentTimeline.id, after) : undefined,
            ),
          )
          .orderBy(asc(npAgentIncidentTimeline.id))
          .limit(BATCH);
        for (const entry of entries) {
          await db
            .select({ id: npAgentIncidents.id })
            .from(npAgentIncidents)
            .where(
              and(
                eq(npAgentIncidents.siteId, input.siteId),
                eq(npAgentIncidents.id, entry.incidentId),
              ),
            )
            .for("update")
            .limit(1);
          try {
            const current = await journal(db, entry);
            if (current) await attempt(db, entry, current);
          } catch (error) {
            if (!evidenceError(error)) throw error; // Corrupt evidence is never repaired/backfilled.
          }
        }
        if (entries.length || cursor) {
          const value = {
            schemaVersion: "np.agent-incident-notification-recovery-cursor.v1",
            afterTimelineId: entries.length === BATCH ? entries.at(-1)!.id : null,
          };
          await db
            .insert(npSettings)
            .values({ siteId: input.siteId, key: CURSOR_KEY, value, updatedAt: options.now() })
            .onConflictDoUpdate({
              target: [npSettings.siteId, npSettings.key],
              set: { value, updatedAt: options.now() },
            });
        }
      });
    },
    async state(db: Db, entry: Entry): Promise<Recovery | null> {
      const current = await journal(db, entry);
      if (!current) return null;
      const source = await npRequireIncidentNotificationRecoverySource(db, entry);
      if (serializeAgentCanonicalJson(source) !== serializeAgentCanonicalJson(current.source))
        fail();
      if (current.recovery.state === "sent" && !(await options.receipt(inputFor(db, source))))
        fail();
      return { ...current.recovery };
    },
  };
}
