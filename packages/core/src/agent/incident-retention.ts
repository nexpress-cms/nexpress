import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  canonicalBodyInteger,
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  npDigestAgentNotificationDeliveryCanonical,
  npRequireAgentNotificationDeliveryCanonical,
} from "../agent-contract/canonical-notification-policy.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentIncidentNotificationsV1 } from "../agent-contract/incident-notifications-contract.js";
import { NpAgentContractError } from "../agent-contract/contract.js";
import {
  npRequireAgentIncidentRetentionPolicyV1,
  type NpAgentIncidentRetentionPolicyV1,
} from "../agent-contract/incident-retention-contract.js";
import type { getDb } from "../db/runtime.js";
import {
  npAgentIncidentTimeline,
  npAgentNotifications,
  npAgentSignals,
} from "../db/schema/agent.js";
import {
  NP_NOTIFICATION_ROUTING_EXPIRED_V1,
  npNotificationTimelineFingerprintV1,
} from "./notification-delivery-evidence.js";
import { npAgentNotificationRetentionEvidenceV1 } from "./notification-retention-evidence.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npAgentSiteOwnedTableNamesV1 } from "./site-deletion.js";
import { npLockAgentSourceReleaseFenceV1 } from "./source-release.js";

type Db = ReturnType<typeof getDb>;
interface Member {
  table: string;
  id: string;
}
interface Source {
  table: string;
  relation: SQL;
  eligible: SQL;
}
const DAY = 86_400_000;
const MAXIMUM_ROWS = 10_000;
const MAXIMUM_BYTES = 16 * 1024 * 1024;
const uuid = (value: unknown) => canonicalBodyUuid(value, "incident.retention.id");
const invalid = (): never => {
  throw new NpAgentGatewayError(
    "RUNTIME_MAINTENANCE_INVALID",
    409,
    "Agent maintenance is unavailable.",
  );
};

/** Explicit host policy only. Caller owns the site control transaction, budget,
 * cursor and receipt. The existing global reference fence precedes row locks.
 * A cohort is indivisible: oversized, active, unknown or referenced history stays.
 * No audit, Action, approval, rollback or source-release record is rewritten. */
export async function npPruneAgentIncidentRetentionV1(options: {
  db: Db;
  siteId: string;
  cursor: string | null;
  limit: number;
  now: Date;
  policy?: NpAgentIncidentRetentionPolicyV1;
  beforeStatement: () => Promise<void>;
  /** Already selected roots from the maintenance owner's unified UUID cursor. */
  rootIds?: readonly string[];
  maximumRows?: number;
}): Promise<{ examined: number; pruned: number; nextCursor: string | null }> {
  npAssertAgentPreviewEffectsAllowed();
  const { db, beforeStatement, siteId, now } = options;
  canonicalBodySiteId(siteId, "incident.retention.siteId");
  const limit = canonicalBodyInteger(options.limit, "incident.retention.limit", 1, 25);
  if (options.cursor !== null) uuid(options.cursor);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) invalid();
  const maximumRows = canonicalBodyInteger(
    options.maximumRows ?? MAXIMUM_ROWS,
    "incident.retention.maximumRows",
    0,
    MAXIMUM_ROWS,
  );
  if (options.policy === undefined) return { examined: 0, pruned: 0, nextCursor: null };
  const policy = npRequireAgentIncidentRetentionPolicyV1(options.policy);
  const signalBefore = new Date(now.getTime() - policy.signalDays * DAY);
  const historyBefore = new Date(now.getTime() - policy.historyDays * DAY);
  const signalAge = sql`t.created_at<=${signalBefore} and t.updated_at<=${signalBefore}
    and t.window_ended_at<=${signalBefore} and t.expires_at<=${now}`;
  const closed = sql`t.status in ('resolved','dismissed') and t.resolved_at<=${historyBefore}
    and t.created_at<=${historyBefore} and t.updated_at<=${historyBefore}
    and t.last_observed_at<=${historyBefore}
    and (t.contained_at is null or t.contained_at<=${historyBefore})`;
  const orphan = sql`t.incident_id is null and t.status in ('suppressed','resolved') and ${signalAge}`;
  const notificationAge = sql`t.created_at<=${historyBefore} and t.updated_at<=${historyBefore}`;
  const localReceipt = sql`t.channel='admin' and t.state='sent' and t.run_id is null and t.action_id is null
    and t.attempts=0 and t.last_error_code is null and t.next_attempt_at is null
    and t.delivery_digest_body is not null and t.delivery_result_digest is not null
    and ${notificationAge} and t.sent_at<=${historyBefore}`;
  const externalReceipt = sql`t.channel<>'admin' and t.state in ('sent','failed','suppressed')
    and t.run_id is null and t.action_id is null and t.next_attempt_at is null
    and t.delivery_digest_body is not null and t.delivery_result_digest is not null
    and t.delivery_digest_body->'result'->>'state' in ('confirmed','permanent_failure','retryable_not_sent')
    and ${notificationAge} and (t.sent_at is null or t.sent_at<=${historyBefore})`;
  const localNotification = sql`${localReceipt}
    and exists (select 1 from np_agent_incidents parent where parent.site_id=t.site_id and parent.id=t.incident_id
      and parent.status in ('resolved','dismissed') and parent.resolved_at<=${historyBefore}
      and parent.created_at<=${historyBefore} and parent.updated_at<=${historyBefore}
      and parent.last_observed_at<=${historyBefore}
      and (parent.contained_at is null or parent.contained_at<=${historyBefore}))
    and not exists (select 1 from np_agent_containments containment where containment.site_id=t.site_id
      and containment.incident_id=t.incident_id and containment.state<>'restored')`;
  let ids: string[];
  if (options.rootIds !== undefined) {
    if (!Array.isArray(options.rootIds) || options.rootIds.length > limit) invalid();
    ids = options.rootIds.map(uuid);
    if (
      new Set(ids).size !== ids.length ||
      ids.some(
        (id, index) =>
          (index > 0 && id <= ids[index - 1]) || (options.cursor !== null && id <= options.cursor),
      )
    )
      invalid();
  } else {
    await beforeStatement();
    const selected = await db.execute(sql`select id from (
      (select t.id from np_agent_incidents t where t.site_id=${siteId} and ${closed}
       ${options.cursor === null ? sql`` : sql`and t.id>${options.cursor}::uuid`} order by t.id limit ${limit})
      union
      (select t.id from np_agent_signals t where t.site_id=${siteId} and ${orphan}
       ${options.cursor === null ? sql`` : sql`and t.id>${options.cursor}::uuid`} order by t.id limit ${limit})
      union
      (select t.id from np_agent_notifications t where t.site_id=${siteId} and ${localNotification}
       ${options.cursor === null ? sql`` : sql`and t.id>${options.cursor}::uuid`} order by t.id limit ${limit})
    ) roots order by id limit ${limit}`);
    ids = selected.rows.map((row) => uuid(row.id));
  }
  if (!ids.length) return { examined: 0, pruned: 0, nextCursor: null };
  await npLockAgentSourceReleaseFenceV1(db, beforeStatement);
  // npSettings is not in the Agent row-guard inventory. Fence generic settings
  // writers too, so a checkpoint/JSON reference cannot race the final delete.
  await beforeStatement();
  await db.execute(sql`lock table np_settings in share mode nowait`);
  await beforeStatement();
  const jobs = await db.execute(sql`select to_regclass('pgboss.job') is not null as present`);
  const hasJobs = jobs.rows[0]?.present === true;
  const referenceTables = [...npAgentSiteOwnedTableNamesV1, "np_agent_site_deletion_sagas"];
  let pruned = 0;

  async function members(sources: Source[], remaining: number): Promise<Member[] | null> {
    const entries: Member[] = [];
    let bytes = 0;
    for (const source of sources) {
      await beforeStatement();
      const rows = await db.execute(sql`select t.id, (${source.eligible}) is true as eligible,
        octet_length(to_jsonb(t)::text) as bytes from ${sql.identifier(source.table)} t
        where t.site_id=${siteId} and ${source.relation} order by t.id
        limit ${remaining - entries.length + 1} for update nowait`);
      for (const row of rows.rows) {
        if (row.eligible !== true) return null;
        bytes += Number(row.bytes);
        if (!Number.isSafeInteger(bytes) || bytes > MAXIMUM_BYTES || entries.length >= remaining)
          return null;
        entries.push({ table: source.table, id: uuid(row.id) });
      }
    }
    return entries;
  }
  async function unreferenced(cohort: Member[]): Promise<boolean> {
    const rows = sql.join(
      cohort.map((entry) => sql`(${entry.table}::text,${entry.id}::uuid)`),
      sql`, `,
    );
    const checks = referenceTables.map(
      (table) => sql`not exists (
      select 1 from ${sql.identifier(table)} dependency where dependency.site_id=${siteId}
      and not exists (select 1 from cohort own where own.table_name=${table} and own.id::text=dependency.id::text)
      and exists (select 1 from cohort target where position(target.id::text in to_jsonb(dependency)::text)>0))`,
    );
    checks.push(sql`not exists (select 1 from np_settings dependency where dependency.site_id=${siteId}
      and exists (select 1 from cohort target where position(target.id::text in to_jsonb(dependency)::text)>0))`);
    checks.push(sql`not exists (select 1 from np_audit_events dependency
      where (dependency.site_id=${siteId} or dependency.site_id is null)
      and exists (select 1 from cohort target where position(target.id::text in to_jsonb(dependency)::text)>0))`);
    if (hasJobs)
      checks.push(sql`not exists (select 1 from pgboss.job dependency
      where dependency.state::text in ('created','retry','active')
      and (dependency.data->>'siteId'=${siteId} or dependency.data->>'siteId' is null)
      and exists (select 1 from cohort target where position(target.id::text in dependency.data::text)>0))`);
    await beforeStatement();
    const result = await db.execute(
      sql`with cohort(table_name,id) as (values ${rows}) select (${sql.join(checks, sql` and `)}) as clear`,
    );
    return result.rows[0]?.clear === true;
  }
  async function canonical(cohort: Member[]): Promise<boolean> {
    const signals = cohort
      .filter((entry) => entry.table === "np_agent_signals")
      .map((entry) => entry.id);
    if (signals.length) {
      await beforeStatement();
      const rows = await db
        .select()
        .from(npAgentSignals)
        .where(and(eq(npAgentSignals.siteId, siteId), inArray(npAgentSignals.id, signals)));
      if (rows.length !== signals.length) return false;
      for (const row of rows) {
        try {
          const body = npRequireAgentSignalEvidenceCanonical({
            schemaVersion: "np.agent-signal-evidence.v1",
            siteId,
            detectorId: row.detectorId,
            detectorVersion: row.detectorVersion,
            category: row.category,
            window: {
              startedAt: row.windowStartedAt.toISOString(),
              endedAt: row.windowEndedAt.toISOString(),
            },
            subject: row.subject,
            evidence: row.evidence,
          });
          if ((await npDigestAgentSignalEvidenceCanonical(body)) !== row.evidenceDigest)
            return false;
        } catch (error) {
          if (error instanceof NpAgentContractError || error instanceof RangeError) return false;
          throw error;
        }
      }
    }
    const notifications = cohort
      .filter((entry) => entry.table === "np_agent_notifications")
      .map((entry) => entry.id);
    if (notifications.length) {
      await beforeStatement();
      const rows = await db
        .select()
        .from(npAgentNotifications)
        .where(
          and(
            eq(npAgentNotifications.siteId, siteId),
            inArray(npAgentNotifications.id, notifications),
          ),
        );
      if (rows.length !== notifications.length) return false;
      for (const row of rows) {
        if (row.channel !== "admin") continue;
        try {
          const body = npRequireAgentNotificationDeliveryCanonical(row.deliveryDigestBody);
          const item = npRequireAgentIncidentNotificationsV1({
            schemaVersion: "np.agent-incident-notifications.v1",
            items: [
              { ...body.payloadRedacted, notificationId: row.id, createdAt: body.observedAt },
            ],
            nextCursor: null,
          }).items[0];
          if (
            body.channel !== "admin" ||
            body.siteId !== siteId ||
            body.notificationId !== row.id ||
            body.source.incidentId !== row.incidentId ||
            body.source.runId !== null ||
            body.source.actionId !== null ||
            body.source.transitionVersion !== row.transitionVersion ||
            !item ||
            item.incidentId !== row.incidentId ||
            item.incidentVersion !== row.transitionVersion ||
            row.deduplicationKey !==
              `incident:${row.incidentId}:admin:${row.transitionVersion}:${item.transition}` ||
            body.deduplicationKey !== row.deduplicationKey ||
            body.observedAt !== row.createdAt.toISOString() ||
            body.observedAt !== row.sentAt?.toISOString() ||
            serializeAgentCanonicalJson(body.payloadRedacted) !==
              serializeAgentCanonicalJson(row.payloadRedacted) ||
            (await npDigestAgentNotificationDeliveryCanonical(body)) !== row.deliveryResultDigest
          )
            return false;
        } catch (error) {
          if (error instanceof NpAgentContractError || error instanceof RangeError) return false;
          throw error;
        }
      }
      const timelineIds = cohort
        .filter((entry) => entry.table === "np_agent_incident_timeline")
        .map((entry) => entry.id);
      await beforeStatement();
      const timeline = timelineIds.length
        ? await db
            .select()
            .from(npAgentIncidentTimeline)
            .where(
              and(
                eq(npAgentIncidentTimeline.siteId, siteId),
                inArray(npAgentIncidentTimeline.id, timelineIds),
              ),
            )
        : [];
      if (
        timeline.length !== timelineIds.length ||
        !(await npAgentNotificationRetentionEvidenceV1(rows, timeline))
      )
        return false;
    }
    return true;
  }
  for (const id of ids) {
    if (pruned >= maximumRows) break;
    await beforeStatement();
    const incident = await db.execute(sql`select t.id from np_agent_incidents t
      where t.site_id=${siteId} and t.id=${id}::uuid and ${closed} for update nowait`);
    await beforeStatement();
    const local = incident.rows.length
      ? null
      : (
          await db.execute(sql`select t.incident_id, t.deduplication_key from np_agent_notifications t
      where t.site_id=${siteId} and t.id=${id}::uuid and ${localNotification} for update nowait`)
        ).rows[0];
    const groupRelation = sql`(t.id=${id}::uuid or (t.channel<>'admin' and t.payload_redacted->>'sourceNotificationId'=${id}))`;
    const sources: Source[] = incident.rows.length
      ? [
          {
            table: "np_agent_notifications",
            relation: sql`t.incident_id=${id}::uuid`,
            eligible: sql`(${localReceipt}) or (${externalReceipt})`,
          },
          {
            table: "np_agent_feedback",
            relation: sql`t.target_kind='incident' and t.target_id=${id}::uuid`,
            eligible: sql`t.created_at<=${historyBefore} and t.provider_call_id is null and t.agent_version_id is null
              and (t.supersedes_id is null or exists (select 1 from np_agent_feedback prior
                where prior.site_id=t.site_id and prior.id=t.supersedes_id and prior.target_kind='incident' and prior.target_id=${id}::uuid))`,
          },
          {
            table: "np_agent_incident_timeline",
            relation: sql`t.incident_id=${id}::uuid`,
            eligible: sql`t.created_at<=${historyBefore}
        and t.kind not in ('action','verification','agent_assessment') and t.run_id is null and t.action_id is null
        and t.approval_id is null and t.provider_call_id is null and t.audit_event_id is null`,
          },
          {
            table: "np_agent_incident_signals",
            relation: sql`t.incident_id=${id}::uuid`,
            eligible: sql`exists (select 1 from np_agent_signals signal where signal.site_id=t.site_id and signal.id=t.signal_id and signal.incident_id=${id}::uuid)`,
          },
          {
            table: "np_agent_signals",
            relation: sql`t.incident_id=${id}::uuid`,
            eligible: sql`t.status in ('attached','suppressed','resolved') and ${signalAge}`,
          },
          {
            table: "np_agent_containments",
            relation: sql`t.incident_id=${id}::uuid`,
            eligible: sql`t.state='restored' and t.restored_at<=${historyBefore}
        and t.created_at<=${historyBefore} and t.updated_at<=${historyBefore} and t.last_error_code is null
        and t.restore_action_id is not null
        and exists (select 1 from np_agent_actions source where source.site_id=t.site_id and source.id=t.source_action_id and source.containment_id=t.id)
        and exists (select 1 from np_agent_actions restoration where restoration.site_id=t.site_id and restoration.id=t.restore_action_id and restoration.containment_id=t.id)`,
          },
          { table: "np_agent_incidents", relation: sql`t.id=${id}::uuid`, eligible: closed },
        ]
      : local
        ? [
            {
              table: "np_agent_notifications",
              relation: groupRelation,
              eligible: sql`(t.id=${id}::uuid and ${localNotification}) or
              (${externalReceipt} and t.incident_id=${local.incident_id}::uuid)`,
            },
            {
              table: "np_agent_incident_timeline",
              relation: sql`t.incident_id=${local.incident_id}::uuid and t.kind='notification'
              and t.details->>'schemaVersion' in ('np.agent-notification-routing.v1','np.agent-notification-attempt.v1')
              and t.source_id in (select t.id from np_agent_notifications t where t.site_id=${siteId} and ${groupRelation})`,
              eligible: sql`t.created_at<=${historyBefore} and t.event_id is null and t.signal_id is null
              and t.run_id is null and t.action_id is null and t.approval_id is null
              and t.provider_call_id is null and t.audit_event_id is null`,
            },
          ]
        : [
            {
              table: "np_agent_signals",
              relation: sql`t.id=${id}::uuid and ${orphan}`,
              eligible: orphan,
            },
            {
              table: "np_agent_notifications",
              relation: sql`t.id=${id}::uuid and ${localNotification}`,
              eligible: localNotification,
            },
          ];
    const cohort = await members(sources, maximumRows - pruned);
    if (!cohort?.length || !(await canonical(cohort)) || !(await unreferenced(cohort))) continue;
    // Deleting each table's complete selected set also handles feedback supersession
    // links internal to the cohort. External children were checked under the fence.
    for (const source of sources) {
      let selected = cohort
        .filter((entry) => entry.table === source.table)
        .map((entry) => entry.id);
      if (!selected.length) continue;
      if (local && source.table === "np_agent_incident_timeline") {
        // The stable transition key survives receipt expiry/recreation, preventing
        // historical local recording recovery from routing the same effect again.
        await beforeStatement();
        const facts = await db
          .select({
            id: npAgentIncidentTimeline.id,
            sequence: npAgentIncidentTimeline.sequence,
            sourceId: npAgentIncidentTimeline.sourceId,
            details: npAgentIncidentTimeline.details,
          })
          .from(npAgentIncidentTimeline)
          .where(
            and(
              eq(npAgentIncidentTimeline.siteId, siteId),
              inArray(npAgentIncidentTimeline.id, selected),
            ),
          );
        if (facts.length !== selected.length) invalid();
        const markers = facts.filter(
          (entry) =>
            entry.sourceId === id &&
            entry.details.schemaVersion === "np.agent-notification-routing.v1",
        );
        if (markers.length > 1) invalid();
        const marker = markers[0];
        if (marker) {
          selected = selected.filter((member) => member !== marker.id);
          // Free the unique sequence first, then move the tombstone to the
          // deleted group's high-water mark. Later max(sequence)+1 appenders
          // must not reuse a position already observed by a retained cursor.
          if (selected.length) {
            await beforeStatement();
            const removed = await db
              .delete(npAgentIncidentTimeline)
              .where(
                and(
                  eq(npAgentIncidentTimeline.siteId, siteId),
                  inArray(npAgentIncidentTimeline.id, selected),
                ),
              )
              .returning({ id: npAgentIncidentTimeline.id });
            if (removed.length !== selected.length) invalid();
            pruned += removed.length;
          }
          const details = { localDeduplicationKey: String(local.deduplication_key) };
          await beforeStatement();
          const compacted = await db
            .update(npAgentIncidentTimeline)
            .set({
              sequence: facts.reduce(
                (maximum, entry) => Math.max(maximum, entry.sequence),
                marker.sequence,
              ),
              sourceId: null,
              sourceFingerprint: npNotificationTimelineFingerprintV1(
                NP_NOTIFICATION_ROUTING_EXPIRED_V1,
                details,
              ),
              summary: "External notification history expired; routing remains closed.",
              details: { schemaVersion: NP_NOTIFICATION_ROUTING_EXPIRED_V1, ...details },
            })
            .where(
              and(
                eq(npAgentIncidentTimeline.siteId, siteId),
                eq(npAgentIncidentTimeline.id, marker.id),
              ),
            )
            .returning({ id: npAgentIncidentTimeline.id });
          if (compacted.length !== 1) invalid();
          pruned += compacted.length;
          continue;
        }
      }
      if (!selected.length) continue;
      await beforeStatement();
      const deleted = await db.execute(sql`delete from ${sql.identifier(source.table)} t
        where t.site_id=${siteId} and t.id in (${sql.join(
          selected.map((member) => sql`${member}::uuid`),
          sql`, `,
        )}) returning t.id`);
      if (deleted.rows.length !== selected.length) invalid();
      pruned += deleted.rows.length;
    }
  }
  return { examined: ids.length, pruned, nextCursor: ids.length === limit ? ids.at(-1)! : null };
}
