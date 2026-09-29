import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentNotifications,
} from "../db/schema/agent.js";
import {
  npRequireAgentNotificationDeliveryCanonical,
  npDigestAgentNotificationDeliveryCanonical,
} from "../agent-contract/canonical-notification-policy.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentIncidentNotificationsV1,
  type NpAgentIncidentNotificationsV1,
  type NpAgentIncidentNotificationTransitionV1,
  type NpAgentIncidentNotificationItemV1,
} from "../agent-contract/incident-notifications-contract.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
  canonicalBodyInteger,
} from "../agent-contract/canonical-body-validation.js";
import {
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
} from "./admin-admission.js";
import type {
  NpAgentIncidentStaffContextV1,
  NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";
import { createAgentCursorCodecV1 } from "./cursor.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
type Db = ReturnType<typeof getDb>;
type Staff = Omit<NpAgentIncidentStaffContextV1, "transaction">;
type Notification = typeof npAgentNotifications.$inferSelect;
export interface NpAgentIncidentNotificationRecordInputV1 {
  db: Db;
  siteId: string;
  incidentId: string;
  transitionVersion: number;
  transition: NpAgentIncidentNotificationTransitionV1;
  timelineId: string;
}
export interface NpAgentIncidentNotificationsServiceV1 {
  /** Trusted owner seam only, in the same transaction as its persisted transition. No backfill. */
  record(input: NpAgentIncidentNotificationRecordInputV1): Promise<void>;
  list(input: Staff & { cursor?: string | null }): Promise<NpAgentIncidentNotificationsV1>;
}
export interface NpAgentIncidentNotificationsServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  cursorHmacKey: Uint8Array;
  now?: () => Date;
}
function fail(): never {
  throw new NpAgentGatewayError(
    "INCIDENT_NOTIFICATIONS_INVALID",
    409,
    "Incident notification is unavailable.",
  );
}
const invalidCursor = () =>
  new NpAgentGatewayError(
    "INCIDENT_NOTIFICATIONS_CURSOR_INVALID",
    400,
    "Notification cursor is invalid.",
  );
function key(incidentId: string, version: number, transition: string) {
  return `incident:${incidentId}:admin:${version}:${transition}`;
}
/** Explicitly installed local feed. No external delivery, jobs or read-side persistence. */
export function createAgentIncidentNotificationsServiceV1(
  options: NpAgentIncidentNotificationsServiceOptionsV1,
): NpAgentIncidentNotificationsServiceV1 {
  const now = options.now ?? (() => new Date());
  const codec = createAgentCursorCodecV1(
    options.cursorHmacKey,
    "np.agent-incident-notifications.cursor",
  );
  async function project(row: Notification): Promise<NpAgentIncidentNotificationItemV1> {
    const body = npRequireAgentNotificationDeliveryCanonical(row.deliveryDigestBody);
    if (
      body.channel !== "admin" ||
      row.channel !== "admin" ||
      row.state !== "sent" ||
      row.attempts !== 0 ||
      !row.incidentId ||
      row.runId !== null ||
      row.actionId !== null ||
      body.siteId !== row.siteId ||
      body.notificationId !== row.id ||
      body.source.incidentId !== row.incidentId ||
      body.source.runId !== null ||
      body.source.actionId !== null ||
      body.source.transitionVersion !== row.transitionVersion ||
      body.deduplicationKey !== row.deduplicationKey ||
      body.observedAt !== row.createdAt.toISOString() ||
      row.sentAt?.toISOString() !== body.observedAt ||
      serializeAgentCanonicalJson(body.payloadRedacted) !==
        serializeAgentCanonicalJson(row.payloadRedacted) ||
      (await npDigestAgentNotificationDeliveryCanonical(body)) !== row.deliveryResultDigest
    )
      fail();
    const parsed = npRequireAgentIncidentNotificationsV1({
      schemaVersion: "np.agent-incident-notifications.v1",
      items: [{ ...body.payloadRedacted, notificationId: row.id, createdAt: body.observedAt }],
      nextCursor: null,
    });
    const item = parsed.items[0];
    if (
      item.incidentId !== row.incidentId ||
      item.incidentVersion !== row.transitionVersion ||
      key(item.incidentId, item.incidentVersion, item.transition) !== row.deduplicationKey
    )
      fail();
    return item;
  }
  return {
    async record(input) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodySiteId(input.siteId, "notification.siteId");
      canonicalBodyUuid(input.incidentId, "notification.incidentId");
      canonicalBodyUuid(input.timelineId, "notification.timelineId");
      canonicalBodyInteger(input.transitionVersion, "notification.version", 1, 2147483647);
      const [incident] = await input.db
        .select()
        .from(npAgentIncidents)
        .where(
          and(eq(npAgentIncidents.siteId, input.siteId), eq(npAgentIncidents.id, input.incidentId)),
        )
        .limit(1);
      const [entry] = await input.db
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
        entry.details.transitionVersion !== input.transitionVersion ||
        entry.details.severity !== incident.severity ||
        incident.status !== (input.transition === "opened" ? "open" : input.transition)
      )
        fail();
      if (input.transition === "opened") {
        if (
          input.transitionVersion !== 1 ||
          entry.kind !== "observed" ||
          entry.sourceKind !== "system" ||
          entry.details.schemaVersion !== "np.agent-incident-signal-entry.v1" ||
          entry.details.disposition !== "created" ||
          !entry.signalId
        )
          fail();
      } else if (
        !["investigating", "resolved", "dismissed"].includes(input.transition) ||
        entry.kind !== "state_transition" ||
        entry.sourceKind !== "staff" ||
        !entry.auditEventId ||
        entry.details.schemaVersion !== "np.agent-incident-transition-entry.v1" ||
        entry.details.toStatus !== input.transition ||
        entry.details.fromStatus === input.transition
      )
        fail();
      const severity = incident.severity;
      if (
        severity !== "critical" &&
        !(input.transition === "opened" && ["medium", "high"].includes(severity)) &&
        !(severity === "high" && input.transition === "resolved")
      )
        return;
      const id = randomUUID();
      const time = entry.createdAt;
      const item = npRequireAgentIncidentNotificationsV1({
        schemaVersion: "np.agent-incident-notifications.v1",
        items: [
          {
            notificationId: id,
            incidentId: incident.id,
            incidentVersion: input.transitionVersion,
            transition: input.transition,
            severity,
            status: incident.status,
            summary: `Incident ${input.transition}.`,
            adminPath: `/admin/agents/incidents/${incident.id}`,
            createdAt: time.toISOString(),
          },
        ],
        nextCursor: null,
      }).items[0];
      const { notificationId: _, createdAt: __, ...payloadRedacted } = item;
      const deduplicationKey = key(incident.id, input.transitionVersion, input.transition);
      const body = npRequireAgentNotificationDeliveryCanonical({
        schemaVersion: "np.agent-notification-delivery.v1",
        siteId: input.siteId,
        notificationId: id,
        channel: "admin",
        source: {
          incidentId: incident.id,
          runId: null,
          actionId: null,
          transitionVersion: input.transitionVersion,
        },
        deduplicationKey,
        payloadRedacted,
        attempt: 0,
        result: { state: "confirmed_local" },
        observedAt: time.toISOString(),
      });
      await input.db
        .insert(npAgentNotifications)
        .values({
          id,
          siteId: input.siteId,
          channel: "admin",
          incidentId: incident.id,
          transitionVersion: input.transitionVersion,
          deduplicationKey,
          state: "sent",
          payloadRedacted,
          attempts: 0,
          deliveryDigestBody: body,
          deliveryResultDigest: await npDigestAgentNotificationDeliveryCanonical(body),
          sentAt: time,
          createdAt: time,
          updatedAt: time,
        })
        .onConflictDoNothing({
          target: [npAgentNotifications.siteId, npAgentNotifications.deduplicationKey],
        });
      const [stored] = await input.db
        .select()
        .from(npAgentNotifications)
        .where(
          and(
            eq(npAgentNotifications.siteId, input.siteId),
            eq(npAgentNotifications.deduplicationKey, deduplicationKey),
          ),
        )
        .limit(1);
      if (!stored) fail();
      const existing = await project(stored);
      if (
        serializeAgentCanonicalJson({ ...existing, notificationId: id }) !==
        serializeAgentCanonicalJson(item)
      )
        fail();
    },
    async list(input) {
      await options.reads.authorize(input);
      const db = getDb();
      const authorize = async () => {
        const auth = await npResolveAgentStaffSessionAuthorizationV1(
          db,
          input.siteId,
          input.actor,
          now(),
        );
        if (!auth.authority.capabilities.includes("admin.manage"))
          throw new NpAgentGatewayError(
            "INCIDENT_FORBIDDEN",
            403,
            "Incident permission is required.",
          );
        return codec.mac(
          serializeAgentCanonicalJson({
            siteId: input.siteId,
            sessionId: input.actor.sessionId,
            auth,
          }),
        );
      };
      const binding = await authorize();
      let position: { time: string; id: string } | null = null;
      if (input.cursor) {
        try {
          const body = codec.open(input.cursor) as {
            binding: unknown;
            expires: unknown;
            position: { time: string; id: string };
          };
          if (
            body.binding !== binding ||
            typeof body.expires !== "number" ||
            body.expires <= now().getTime() ||
            !Number.isFinite(Date.parse(body.position.time))
          )
            throw invalidCursor();
          canonicalBodyUuid(body.position.id, "notification.cursor.id");
          position = body.position;
        } catch {
          throw invalidCursor();
        }
      }
      const rows = await db
        .select()
        .from(npAgentNotifications)
        .where(
          and(
            eq(npAgentNotifications.siteId, input.siteId),
            eq(npAgentNotifications.channel, "admin"),
            position
              ? sql`(${npAgentNotifications.createdAt},${npAgentNotifications.id}) < (${position.time}::timestamptz,${position.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(npAgentNotifications.createdAt), desc(npAgentNotifications.id))
        .limit(21);
      const items: NpAgentIncidentNotificationItemV1[] = [];
      for (const row of rows.slice(0, 20)) {
        try {
          const item = await project(row);
          await options.reads.get({ incidentId: item.incidentId }, { ...input, transaction: db });
          items.push(item);
        } catch (error) {
          if (error instanceof NpAgentGatewayError && [403, 404, 409].includes(error.status))
            continue;
          throw error;
        }
      }
      if ((await authorize()) !== binding) throw invalidCursor();
      const last = rows[19];
      return npRequireAgentIncidentNotificationsV1({
        schemaVersion: "np.agent-incident-notifications.v1",
        items,
        nextCursor:
          rows.length > 20 && last
            ? codec.seal({
                binding,
                expires: now().getTime() + 900000,
                position: { time: last.createdAt.toISOString(), id: last.id },
              })
            : null,
      });
    },
  };
}
