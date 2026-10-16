import {
  NP_NOTIFICATION_ROUTING_EXPIRED_V1,
  npNotificationTimelineFingerprintV1,
  npRequireNotificationDeliveryAttemptHistoryV1,
  npNotificationDeliverySnapshotV1 as snapshot,
  npNotificationDeliveryBodyV1 as body,
  npNotificationDeliveryImmutableV1 as immutable,
  npRequireNotificationDeliveryLedgerV1 as ledger,
} from "./notification-delivery-evidence.js";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentIncidents,
  npAgentIncidentTimeline,
  npAgentNotifications,
} from "../db/schema/agent.js";
import { npSettings, npSites } from "../db/schema/system.js";
import { npLockSiteQuotas } from "../sites/quotas.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentNotificationDeliveryCanonical,
  npDigestAgentNotificationDeliveryCanonical,
} from "../agent-contract/canonical-notification-policy.js";
import { npRequireAgentIncidentNotificationsV1 } from "../agent-contract/incident-notifications-contract.js";
import { npRequireAgentIncidentNotificationDeliveriesV1 } from "../agent-contract/incident-notification-deliveries-contract.js";
import {
  npAgentNotificationDeliveryLimitsV1,
  npRequireAgentNotificationDeliveryResultV1,
  type NpAgentNotificationDeliveryResultV1,
} from "../agent-contract/notification-delivery-contract.js";
import { npResolveAgentPolicyV1 } from "../agent-contract/runtime-policy.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
import {
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
} from "./admin-admission.js";
import { createAgentCursorCodecV1 } from "./cursor.js";
import { NpAgentProviderError } from "./provider-auth-contract.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npRequireIncidentContainmentFailure } from "./incident-containment-failure.js";
import { npRequireIncidentSeverityEvidence } from "./incident-severity-evidence.js";
import type { createAgentConnectionServiceV1 } from "./connection-service.js";
import type { NpAgentConnectionAuthAdapterRegistryV1 } from "./provider-auth-contract.js";
import type { NpAgentVaultServiceV1 } from "./vault-service.js";
import type { NpProviderCredentialLeaseV1 } from "./vault-contract.js";
import { enqueueJob } from "../jobs/queue.js";
import type { NpAgentIncidentNotificationDeliveriesV1 } from "../agent-contract/incident-notification-deliveries-contract.js";
import type { NpAgentExternalNotificationChannelV1 } from "../agent-contract/notification-delivery-contract.js";
import type { NpAgentPolicyResolutionInputV1 } from "../agent-contract/runtime-policy.js";
import type { NpAgentIncidentNotificationItemV1 } from "../agent-contract/incident-notifications-contract.js";
import type {
  NpAgentIncidentStaffContextV1,
  NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";

type Db = ReturnType<typeof getDb>;
export interface NpAgentNotificationRouteV1 {
  channel: NpAgentExternalNotificationChannelV1;
  connectionId: string;
}
export interface NpAgentNotificationDeliveryServiceV1 {
  /** Existing trusted local notification owner, inside its transaction. */
  queue(input: { db: Db; siteId: string; notificationId: string }): Promise<void>;
  process(input: {
    siteId: string;
    notificationId: string;
    expectedAttempt: number;
  }): Promise<void>;
  /** Durable bounded recovery; never a send-on-read path. */
  reconcile(input: { siteId: string }): Promise<void>;
  list(
    input: NpAgentIncidentStaffContextV1 & { incidentId: string; cursor?: string | null },
  ): Promise<NpAgentIncidentNotificationDeliveriesV1>;
}
export interface NpAgentNotificationDeliveryAuthorizationV1 {
  /** Re-resolved current policy layers, never an assertion from the job payload. */
  policy: NpAgentPolicyResolutionInputV1;
  /** Current recipient visibility is independently checked through the existing Incident reader. */
  recipient: NpAgentIncidentStaffContextV1;
}
export interface NpAgentNotificationDeliveryRoutingOptionsV1 {
  /** Explicit installation cutoff: no invented historical backfill. */
  notBefore: string;
  reads: NpAgentIncidentStaffReadServiceV1;
  resolveRoutes(input: {
    db: Db;
    siteId: string;
    notification: NpAgentIncidentNotificationItemV1;
  }): Promise<readonly NpAgentNotificationRouteV1[]>;
  authorizeRoute(input: {
    db: Db;
    siteId: string;
    route: NpAgentNotificationRouteV1;
    notification: NpAgentIncidentNotificationItemV1;
    phase: "queue" | "dispatch";
  }): Promise<NpAgentNotificationDeliveryAuthorizationV1 | null>;
  canReviewAction?(
    input: NpAgentIncidentStaffContextV1 & { db: Db; incidentId: string; actionId: string },
  ): boolean | Promise<boolean>;
  cursorHmacKey: Uint8Array;
  now?: () => Date;
}

type Row = typeof npAgentNotifications.$inferSelect;
const ROUTING = "np.agent-notification-routing.v1";
const DELIVERY = "np.agent-notification-attempt.v1";
const CURSORS = "agents.notificationDelivery.cursors.v1";
const MAX_ROUTES = 8;
const BATCH = 25;
const LIMITS = npAgentNotificationDeliveryLimitsV1;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function unavailable(code = "NOTIFICATION_DELIVERY_UNAVAILABLE"): never {
  throw new NpAgentGatewayError(code, 409, "External notification delivery is unavailable.");
}
function sourceKey(localId: string) {
  return `notification:${localId}`;
}
function externalKey(localId: string, route: NpAgentNotificationRouteV1) {
  return `${sourceKey(localId)}:${route.channel}:${route.connectionId}`;
}
/** Explicit durable outbox. Hosts supply trusted routing/current policy and register existing jobs. */
export function createAgentNotificationDeliveryServiceV1(
  options: NpAgentNotificationDeliveryRoutingOptionsV1 & {
    connections: Pick<ReturnType<typeof createAgentConnectionServiceV1>, "notificationDelivery">;
    registry: NpAgentConnectionAuthAdapterRegistryV1;
    vault: Pick<NpAgentVaultServiceV1, "leaseProviderCredential">;
  },
): NpAgentNotificationDeliveryServiceV1 {
  const notBefore = new Date(canonicalBodyUtc(options.notBefore, "notification.notBefore"));
  const now = options.now ?? (() => new Date());
  const codec = createAgentCursorCodecV1(
    options.cursorHmacKey,
    "np.agent-incident-deliveries.cursor",
  );
  if (typeof options.resolveRoutes !== "function" || typeof options.authorizeRoute !== "function")
    unavailable();

  async function local(
    db: Db,
    siteId: string,
    id: string,
  ): Promise<{ row: Row; item: NpAgentIncidentNotificationItemV1 }> {
    const [row] = await db
      .select()
      .from(npAgentNotifications)
      .where(and(eq(npAgentNotifications.siteId, siteId), eq(npAgentNotifications.id, id)))
      .limit(1);
    if (
      !row ||
      row.channel !== "admin" ||
      row.state !== "sent" ||
      row.attempts !== 0 ||
      !row.incidentId ||
      row.runId ||
      row.actionId ||
      row.connectionId ||
      row.providerMessageId ||
      row.lastErrorCode ||
      row.nextAttemptAt ||
      row.sentAt?.toISOString() !== row.createdAt.toISOString()
    )
      unavailable("NOTIFICATION_EVIDENCE_INVALID");
    const receipt = npRequireAgentNotificationDeliveryCanonical(row.deliveryDigestBody);
    if (
      receipt.channel !== "admin" ||
      receipt.siteId !== siteId ||
      receipt.notificationId !== row.id ||
      receipt.source.incidentId !== row.incidentId ||
      receipt.source.runId ||
      receipt.source.actionId ||
      receipt.source.transitionVersion !== row.transitionVersion ||
      receipt.deduplicationKey !== row.deduplicationKey ||
      receipt.observedAt !== row.createdAt.toISOString() ||
      !same(receipt.payloadRedacted, row.payloadRedacted) ||
      (await npDigestAgentNotificationDeliveryCanonical(receipt)) !== row.deliveryResultDigest
    )
      unavailable("NOTIFICATION_EVIDENCE_INVALID");
    const item = npRequireAgentIncidentNotificationsV1({
      schemaVersion: "np.agent-incident-notifications.v1",
      items: [
        { ...receipt.payloadRedacted, notificationId: row.id, createdAt: receipt.observedAt },
      ],
      nextCursor: null,
    }).items[0];
    if (
      item.incidentId !== row.incidentId ||
      item.incidentVersion !== row.transitionVersion ||
      row.deduplicationKey !==
        `incident:${item.incidentId}:admin:${item.incidentVersion}:${item.transition}`
    )
      unavailable("NOTIFICATION_EVIDENCE_INVALID");
    return { row, item };
  }

  async function source(db: Db, row: Row) {
    const id = canonicalBodyUuid(row.payloadRedacted.sourceNotificationId, "notification.sourceId");
    const receipt = await local(db, row.siteId, id);
    const recipientFingerprint = row.payloadRedacted.recipientFingerprint;
    if (
      typeof recipientFingerprint !== "string" ||
      !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(recipientFingerprint)
    )
      unavailable("NOTIFICATION_EVIDENCE_INVALID");
    if (
      receipt.item.incidentId !== row.incidentId ||
      receipt.item.incidentVersion !== row.transitionVersion ||
      !same(row.payloadRedacted, {
        ...receipt.row.payloadRedacted,
        sourceNotificationId: id,
        recipientFingerprint,
      }) ||
      row.deduplicationKey !==
        externalKey(id, {
          channel: row.channel as NpAgentExternalNotificationChannelV1,
          connectionId: row.connectionId!,
        })
    )
      unavailable("NOTIFICATION_EVIDENCE_INVALID");
    return receipt;
  }

  async function visible(
    db: Db,
    item: NpAgentIncidentNotificationItemV1,
    context: NpAgentIncidentStaffContextV1,
  ) {
    await options.reads.get({ incidentId: item.incidentId }, { ...context, transaction: db });
    if (item.transition === "containment_failed" || item.transition === "escalated") {
      const entries = await db
        .select()
        .from(npAgentIncidentTimeline)
        .where(
          and(
            eq(npAgentIncidentTimeline.siteId, context.siteId),
            eq(npAgentIncidentTimeline.incidentId, item.incidentId),
            sql`${npAgentIncidentTimeline.details}->>'transitionVersion' = ${String(item.incidentVersion)}`,
            sql`${npAgentIncidentTimeline.details}->>'schemaVersion' = ${item.transition === "containment_failed" ? "np.agent-incident-containment-failure-entry.v1" : "np.agent-incident-severity-entry.v1"}`,
          ),
        )
        .limit(2);
      const entry = entries[0];
      if (
        entries.length !== 1 ||
        !entry ||
        entry.createdAt.toISOString() !== item.createdAt ||
        (item.transition === "containment_failed" && entry.details.severity !== item.severity) ||
        entry.details.status !== item.status
      )
        unavailable("NOTIFICATION_SOURCE_UNAVAILABLE");
      if (item.transition === "escalated") {
        const change = await npRequireIncidentSeverityEvidence(db, entry);
        if (change.toSeverity !== item.severity) unavailable("NOTIFICATION_SOURCE_UNAVAILABLE");
      } else {
        if (!entry.actionId || !entry.auditEventId || !options.canReviewAction)
          unavailable("NOTIFICATION_AUTHORITY_REVOKED");
        const proof = await npRequireIncidentContainmentFailure({
          db,
          siteId: context.siteId,
          incidentId: item.incidentId,
          actionId: entry.actionId,
          auditEventId: entry.auditEventId,
        });
        if (
          entry.sourceKind !== "system" ||
          entry.kind !== "action" ||
          entry.sourceFingerprint !== proof.action.inputHash ||
          entry.details.executionInvocationId !== proof.execution.id ||
          entry.details.phase !== "failed" ||
          entry.details.outcome !== "rolled_back" ||
          (await options.canReviewAction({
            ...context,
            db,
            incidentId: item.incidentId,
            actionId: entry.actionId,
          })) !== true
        )
          unavailable("NOTIFICATION_AUTHORITY_REVOKED");
      }
    }
  }

  async function authorized(
    db: Db,
    item: NpAgentIncidentNotificationItemV1,
    siteId: string,
    route: NpAgentNotificationRouteV1,
    phase: "queue" | "dispatch",
  ) {
    const authorization = await options.authorizeRoute({
      db,
      siteId,
      route: structuredClone(route),
      notification: structuredClone(item),
      phase,
    });
    if (!authorization || authorization.recipient.siteId !== siteId) return false;
    const policy = npResolveAgentPolicyV1(authorization.policy);
    const rank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
    if (
      !policy.escalation.channels.includes(route.channel) ||
      rank[item.severity] < rank[policy.escalation.minimumSeverity] ||
      policy.providerDataMaximum === "public-only"
    )
      return false;
    const { incident } = await options.reads.get(
      { incidentId: item.incidentId },
      { ...authorization.recipient, transaction: db },
    );
    await visible(db, item, authorization.recipient);
    const sources = await npReadAgentIncidentCanonicalSourcesV1({ db, siteId, incident });
    const category = (value: typeof incident.category) =>
      policy.resources.incidentCategories === null ||
      policy.resources.incidentCategories.includes(value);
    const subject = (value: typeof incident.primarySubject) =>
      value === null ||
      (value.kind === "site"
        ? value.siteId === siteId
        : (value.kind !== "document" && value.kind !== "comment") ||
          policy.resources.collections === null ||
          policy.resources.collections.includes(value.collection));
    if (
      !category(incident.category) ||
      !subject(incident.primarySubject) ||
      sources.signals.some(
        (signal) =>
          !category(signal.category) ||
          !subject(signal.subject) ||
          signal.evidence.some(
            (ref) =>
              (ref.kind === "revision" &&
                policy.resources.collections !== null &&
                !policy.resources.collections.includes(ref.collection)) ||
              (ref.kind === "external-signal" && policy.resources.collections !== null),
          ),
      ) ||
      sources.events.some((event) => !subject(event.subject))
    )
      return false;
    return `cj1:sha256:${createHash("sha256")
      .update("np.agent-notification-recipient.v1\0")
      .update(
        serializeAgentCanonicalJson({
          siteId,
          userId: authorization.recipient.actor.user.id,
          sessionId: authorization.recipient.actor.sessionId,
        }),
      )
      .digest("base64url")}`;
  }

  async function lockIncident(db: Db, siteId: string, incidentId: string) {
    const [incident] = await db
      .select({ id: npAgentIncidents.id })
      .from(npAgentIncidents)
      .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, incidentId)))
      .for("update")
      .limit(1);
    if (!incident) unavailable("NOTIFICATION_SOURCE_UNAVAILABLE");
  }
  async function append(
    db: Db,
    row: Row,
    schemaVersion: typeof ROUTING | typeof DELIVERY,
    details: NpAgentJsonObject,
    at: Date,
  ) {
    if (!row.incidentId) unavailable();
    const [last] = await db
      .select({ maximum: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)` })
      .from(npAgentIncidentTimeline)
      .where(
        and(
          eq(npAgentIncidentTimeline.siteId, row.siteId),
          eq(npAgentIncidentTimeline.incidentId, row.incidentId),
        ),
      );
    await db.insert(npAgentIncidentTimeline).values({
      siteId: row.siteId,
      incidentId: row.incidentId,
      sequence: canonicalBodyInteger(
        Number(last?.maximum ?? 0) + 1,
        "notification.sequence",
        1,
        2147483647,
      ),
      kind: "notification",
      sourceKind: "system",
      sourceId: row.id,
      sourceFingerprint: npNotificationTimelineFingerprintV1(schemaVersion, details),
      summary:
        schemaVersion === ROUTING
          ? "External notification routing recorded."
          : "External notification delivery updated.",
      details: { schemaVersion, ...details },
      createdAt: at,
    });
  }

  async function queue(input: Parameters<NpAgentNotificationDeliveryServiceV1["queue"]>[0]) {
    npAssertAgentPreviewEffectsAllowed();
    canonicalBodySiteId(input.siteId, "notification.siteId");
    canonicalBodyUuid(input.notificationId, "notification.id");
    await input.db.transaction((transaction) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ db }) => {
          const receipt = await local(db, input.siteId, input.notificationId);
          if (receipt.row.createdAt < notBefore) return;
          await lockIncident(db, input.siteId, receipt.item.incidentId);
          const prior = await db
            .select({ id: npAgentIncidentTimeline.id })
            .from(npAgentIncidentTimeline)
            .where(
              and(
                eq(npAgentIncidentTimeline.siteId, input.siteId),
                eq(npAgentIncidentTimeline.incidentId, receipt.item.incidentId),
                or(
                  and(
                    eq(npAgentIncidentTimeline.sourceId, receipt.row.id),
                    sql`${npAgentIncidentTimeline.details}->>'schemaVersion' = ${ROUTING}`,
                  ),
                  and(
                    sql`${npAgentIncidentTimeline.details}->>'schemaVersion' = ${NP_NOTIFICATION_ROUTING_EXPIRED_V1}`,
                    sql`${npAgentIncidentTimeline.details}->>'localDeduplicationKey' = ${receipt.row.deduplicationKey}`,
                  ),
                ),
              ),
            )
            .limit(1);
          if (prior.length) return;
          const routes = await options.resolveRoutes({
            db,
            siteId: input.siteId,
            notification: receipt.item,
          });
          if (!Array.isArray(routes) || routes.length > MAX_ROUTES)
            unavailable("NOTIFICATION_ROUTING_INVALID");
          const keys = new Set<string>();
          const ids: string[] = [];
          for (const route of routes) {
            if (
              !route ||
              !same(Object.keys(route).sort(), ["channel", "connectionId"]) ||
              !["email", "slack", "webhook", "siem"].includes(route.channel)
            )
              unavailable("NOTIFICATION_ROUTING_INVALID");
            canonicalBodyUuid(route.connectionId, "notification.connectionId");
            const key = externalKey(receipt.row.id, route);
            if (keys.has(key)) unavailable("NOTIFICATION_ROUTING_INVALID");
            keys.add(key);
            const recipientFingerprint = await authorized(
              db,
              receipt.item,
              input.siteId,
              route,
              "queue",
            );
            if (!recipientFingerprint) continue;
            const s = await options.connections.notificationDelivery.prepare({
              siteId: input.siteId,
              connectionId: route.connectionId,
              transaction: db,
            });
            const current = await options.connections.notificationDelivery.assertCurrent({
              siteId: input.siteId,
              snapshot: s,
              transaction: db,
            });
            if (current.dataProcessingCeiling === "public-only") continue;
            const adapter = options.registry.resolve({
              id: s.adapterId,
              contractVersion: s.adapterContractVersion,
              fingerprint: s.adapterFingerprint,
            });
            if (!adapter.notification?.channels.includes(route.channel))
              unavailable("NOTIFICATION_ADAPTER_UNAVAILABLE");
            const id = randomUUID();
            const at = now();
            await db.insert(npAgentNotifications).values({
              id,
              siteId: input.siteId,
              channel: route.channel,
              connectionId: s.connectionId,
              connectionConfigSnapshotId: s.configSnapshotId,
              adapterId: s.adapterId,
              adapterContractVersion: s.adapterContractVersion,
              adapterFingerprint: s.adapterFingerprint,
              connectionConfigVersion: s.configVersion,
              connectionConfigHash: s.configHash,
              accountSubjectKeyId: s.accountSubjectKeyId,
              accountSubjectDigest: s.accountSubjectDigest,
              destinationKeyId: s.destinationKeyId,
              destinationDescriptor: s.destinationDescriptor,
              destinationFingerprint: s.destinationFingerprint,
              adapterIdempotency: adapter.notification.idempotency,
              incidentId: receipt.item.incidentId,
              transitionVersion: receipt.item.incidentVersion,
              deduplicationKey: key,
              state: "queued",
              payloadRedacted: {
                ...receipt.row.payloadRedacted,
                sourceNotificationId: receipt.row.id,
                recipientFingerprint,
              },
              attempts: 0,
              createdAt: at,
              updatedAt: at,
            });
            ids.push(id);
          }
          await append(
            db,
            receipt.row,
            ROUTING,
            { localNotificationId: receipt.row.id, notificationIds: ids },
            now(),
          );
        },
        transaction,
      ),
    );
    // The registered reconcile job reads only committed rows, including lost creation notifications.
  }

  async function withRow<T>(
    siteId: string,
    id: string,
    operation: (db: Db, row: Row) => Promise<T>,
    converge = false,
  ): Promise<T | undefined> {
    const run = async (db: Db): Promise<T | undefined> => {
      const [initial] = await db
        .select()
        .from(npAgentNotifications)
        .where(and(eq(npAgentNotifications.siteId, siteId), eq(npAgentNotifications.id, id)))
        .limit(1);
      if (!initial || initial.channel === "admin" || !initial.incidentId) return;
      await lockIncident(db, siteId, initial.incidentId);
      const [row] = await db
        .select()
        .from(npAgentNotifications)
        .where(and(eq(npAgentNotifications.siteId, siteId), eq(npAgentNotifications.id, id)))
        .for("update")
        .limit(1);
      if (!row || row.incidentId !== initial.incidentId) unavailable();
      await ledger(row);
      return operation(db, row);
    };
    if (!converge) return npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) => run(db));
    // Persist an already dispatched effect even when new-work controls change.
    // Share the deletion lock order; this branch never claims or dispatches work.
    return getDb().transaction(async (transaction) => {
      const db = transaction as Db;
      await npLockSiteQuotas(db as unknown as Parameters<typeof npLockSiteQuotas>[0], siteId);
      const [site] = await db
        .select({ id: npSites.id })
        .from(npSites)
        .where(eq(npSites.id, siteId))
        .for("share")
        .limit(1);
      if (!site) unavailable("NOTIFICATION_SITE_UNAVAILABLE");
      return run(db);
    });
  }
  async function finish(
    db: Db,
    row: Row,
    result: NpAgentNotificationDeliveryResultV1,
    at: Date,
    suppressed = false,
  ) {
    const retry =
      !suppressed &&
      row.attempts < LIMITS.maxAttempts &&
      (result.state === "retryable_not_sent" ||
        (result.state === "ambiguous" && row.adapterIdempotency === "enforced"));
    const state = suppressed
      ? "suppressed"
      : result.state === "confirmed"
        ? "sent"
        : retry
          ? "queued"
          : "failed";
    const error =
      result.state === "confirmed"
        ? null
        : result.state === "ambiguous"
          ? "DELIVERY_AMBIGUOUS"
          : result.errorCode;
    const canonical = body(
      row,
      result.state === "confirmed"
        ? { state: "confirmed" }
        : { state: result.state, errorCode: error! },
      at,
    );
    const digest = await npDigestAgentNotificationDeliveryCanonical(canonical);
    const updated = await db
      .update(npAgentNotifications)
      .set({
        state,
        deliveryDigestBody: canonical,
        deliveryResultDigest: digest,
        lastErrorCode: error,
        providerMessageId: result.state === "confirmed" ? result.providerMessageId : null,
        sentAt: result.state === "confirmed" ? at : null,
        nextAttemptAt: retry
          ? new Date(at.getTime() + LIMITS.retryDelaySeconds[row.attempts - 1] * 1000)
          : null,
        updatedAt: at,
      })
      .where(
        and(
          eq(npAgentNotifications.siteId, row.siteId),
          eq(npAgentNotifications.id, row.id),
          eq(npAgentNotifications.state, "sending"),
          eq(npAgentNotifications.attempts, row.attempts),
          eq(npAgentNotifications.updatedAt, row.updatedAt),
        ),
      )
      .returning({ id: npAgentNotifications.id });
    if (updated.length !== 1) unavailable("NOTIFICATION_ATTEMPT_CONFLICT");
    await append(
      db,
      row,
      DELIVERY,
      {
        notificationId: row.id,
        attempt: row.attempts,
        state,
        result: canonical.result,
        deliveryResultDigest: digest,
        observedAt: at.toISOString(),
      },
      at,
    );
  }

  async function process(input: Parameters<NpAgentNotificationDeliveryServiceV1["process"]>[0]) {
    npAssertAgentPreviewEffectsAllowed();
    canonicalBodySiteId(input.siteId, "notification.siteId");
    canonicalBodyUuid(input.notificationId, "notification.id");
    canonicalBodyInteger(input.expectedAttempt, "notification.attempt", 0, LIMITS.maxAttempts);
    const started = performance.now();
    const claimed = await withRow(input.siteId, input.notificationId, async (db, row) => {
      if (row.attempts !== input.expectedAttempt) return null;
      if (row.state === "sending") {
        if (row.updatedAt.getTime() + 15_000 > now().getTime()) return null;
        await finish(db, row, { state: "ambiguous", errorCode: "DELIVERY_AMBIGUOUS" }, now());
        return null;
      }
      if (
        row.state !== "queued" ||
        row.attempts >= LIMITS.maxAttempts ||
        (row.nextAttemptAt && row.nextAttemptAt > now())
      )
        return null;
      // Claim is the durable fence before any credential I/O; a crash conservatively means unknown.
      const [updated] = await db
        .update(npAgentNotifications)
        .set({
          state: "sending",
          attempts: row.attempts + 1,
          nextAttemptAt: null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(npAgentNotifications.siteId, row.siteId),
            eq(npAgentNotifications.id, row.id),
            eq(npAgentNotifications.state, "queued"),
            eq(npAgentNotifications.attempts, row.attempts),
          ),
        )
        .returning();
      return updated ?? null;
    });
    if (!claimed) return;
    let lease: NpProviderCredentialLeaseV1 | undefined;
    let result: NpAgentNotificationDeliveryResultV1 = {
      state: "retryable_not_sent",
      errorCode: "DELIVERY_CREDENTIAL_UNAVAILABLE",
    };
    let suppressed = false;
    let dispatched = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const preflight = await withRow(input.siteId, input.notificationId, async (db, row) => {
        if (
          row.state !== "sending" ||
          row.attempts !== claimed.attempts ||
          row.updatedAt.getTime() !== claimed.updatedAt.getTime() ||
          !same(immutable(row), immutable(claimed))
        )
          return null;
        const receipt = await source(db, row);
        if (
          (await authorized(
            db,
            receipt.item,
            row.siteId,
            {
              channel: row.channel as NpAgentExternalNotificationChannelV1,
              connectionId: row.connectionId!,
            },
            "dispatch",
          )) !== row.payloadRedacted.recipientFingerprint
        )
          return null;
        const current = await options.connections.notificationDelivery.assertCurrent({
          siteId: row.siteId,
          snapshot: snapshot(row),
          transaction: db,
        });
        return current.dataProcessingCeiling === "public-only" ? null : current;
      });
      if (!preflight) {
        suppressed = true;
        result = { state: "permanent_failure", errorCode: "DELIVERY_AUTHORITY_REVOKED" };
      } else {
        lease = await options.vault.leaseProviderCredential({
          siteId: input.siteId,
          secretVersionId: preflight.secretVersionId,
          use: "runtime",
        });
        const dispatch = await withRow(input.siteId, input.notificationId, async (db, row) => {
          if (
            row.state !== "sending" ||
            row.attempts !== claimed.attempts ||
            row.updatedAt.getTime() !== claimed.updatedAt.getTime() ||
            !same(immutable(row), immutable(claimed))
          )
            return null;
          const receipt = await source(db, row);
          if (
            (await authorized(
              db,
              receipt.item,
              row.siteId,
              {
                channel: row.channel as NpAgentExternalNotificationChannelV1,
                connectionId: row.connectionId!,
              },
              "dispatch",
            )) !== row.payloadRedacted.recipientFingerprint
          )
            return null;
          const current = await options.connections.notificationDelivery.assertCurrent({
            siteId: row.siteId,
            snapshot: snapshot(row),
            transaction: db,
          });
          if (current.dataProcessingCeiling === "public-only") return null;
          if (
            current.secretVersionId !== lease!.secretVersionId ||
            lease!.envelopeVersion !== 1 ||
            !Number.isFinite(Date.parse(lease!.expiresAt)) ||
            Date.parse(lease!.expiresAt) <= now().getTime()
          )
            throw new NpAgentProviderError(
              "NOTIFICATION_CREDENTIAL_UNAVAILABLE",
              "Notification credential is unavailable.",
              true,
            );
          const adapter = options.registry.resolve({
            id: row.adapterId!,
            contractVersion: row.adapterContractVersion!,
            fingerprint: row.adapterFingerprint!,
          });
          if (
            !adapter.notification?.channels.includes(
              row.channel as NpAgentExternalNotificationChannelV1,
            ) ||
            adapter.notification.idempotency !== row.adapterIdempotency
          )
            return null;
          return { connection: current.connection, facet: adapter.notification };
        });
        if (!dispatch) {
          suppressed = true;
          result = { state: "permanent_failure", errorCode: "DELIVERY_AUTHORITY_REVOKED" };
        } else {
          const remaining = Math.min(
            10_000 - (performance.now() - started),
            claimed.updatedAt.getTime() + 10_000 - now().getTime(),
            Date.parse(lease.expiresAt) - now().getTime(),
          );
          if (!Number.isFinite(remaining) || remaining <= 0)
            result = { state: "retryable_not_sent", errorCode: "DELIVERY_NOT_DISPATCHED" };
          else {
            const interrupted = new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error("Notification interrupted"));
              }, remaining);
            });
            dispatched = true;
            const raw = await Promise.race([
              Promise.resolve().then(() => {
                if (controller.signal.aborted) throw new Error("Notification interrupted");
                return dispatch.facet.send(
                  {
                    schemaVersion: "np.agent-notification-delivery.v1",
                    notificationId: claimed.id,
                    channel: claimed.channel as NpAgentExternalNotificationChannelV1,
                    deduplicationKey: claimed.deduplicationKey,
                    payloadRedacted: structuredClone(claimed.payloadRedacted),
                  },
                  {
                    connection: dispatch.connection,
                    credentialLease: lease!,
                    signal: controller.signal,
                  },
                );
              }),
              interrupted,
            ]);
            result = npRequireAgentNotificationDeliveryResultV1(raw);
          }
        }
      }
    } catch (error) {
      if (dispatched) result = { state: "ambiguous", errorCode: "DELIVERY_AMBIGUOUS" };
      else {
        suppressed =
          (error instanceof NpAgentProviderError &&
            [
              "NOTIFICATION_CONNECTION_CHANGED",
              "NOTIFICATION_DESTINATION_CHANGED",
              "NOTIFICATION_CONNECTION_UNAVAILABLE",
            ].includes(error.code)) ||
          (error instanceof NpAgentGatewayError && [401, 403, 404].includes(error.status));
        result = suppressed
          ? { state: "permanent_failure", errorCode: "DELIVERY_CONNECTION_CHANGED" }
          : { state: "retryable_not_sent", errorCode: "DELIVERY_NOT_DISPATCHED" };
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      try {
        lease?.dispose();
      } catch {
        /* Never surface a credential implementation exception. */
      }
    }
    await withRow(
      input.siteId,
      input.notificationId,
      async (db, row) => {
        if (
          row.state !== "sending" ||
          row.attempts !== claimed.attempts ||
          row.updatedAt.getTime() !== claimed.updatedAt.getTime() ||
          !same(immutable(row), immutable(claimed))
        )
          return;
        await finish(db, row, result, now(), suppressed);
      },
      true,
    );
  }

  async function reconcile(input: { siteId: string }) {
    npAssertAgentPreviewEffectsAllowed();
    canonicalBodySiteId(input.siteId, "notification.siteId");
    const current = await npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext('np.notification.delivery'), hashtext(${input.siteId}))`,
      );
      const [setting] = await db
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, input.siteId), eq(npSettings.key, CURSORS)))
        .limit(1);
      const value = setting
        ? canonicalBodyRecord(
            setting.value,
            "notification.cursors",
            ["local", "pending"],
            ["local", "pending"],
            { seen: new WeakSet<object>() },
          )
        : null;
      const parseCursor = (v: unknown) =>
        v === null || v === undefined ? null : canonicalBodyUuid(v, "notification.reconcileCursor");
      const localCursor = parseCursor(value?.local);
      const pendingCursor = parseCursor(value?.pending);
      const sources = await db
        .select({ id: npAgentNotifications.id })
        .from(npAgentNotifications)
        .where(
          and(
            eq(npAgentNotifications.siteId, input.siteId),
            eq(npAgentNotifications.channel, "admin"),
            gt(npAgentNotifications.createdAt, new Date(notBefore.getTime() - 1)),
            localCursor ? gt(npAgentNotifications.id, localCursor) : undefined,
          ),
        )
        .orderBy(asc(npAgentNotifications.id))
        .limit(BATCH);
      const pending = await db
        .select()
        .from(npAgentNotifications)
        .where(
          and(
            eq(npAgentNotifications.siteId, input.siteId),
            sql`${npAgentNotifications.channel}<>'admin'`,
            inArray(npAgentNotifications.state, ["queued", "sending"]),
            pendingCursor ? gt(npAgentNotifications.id, pendingCursor) : undefined,
            or(
              and(
                eq(npAgentNotifications.state, "queued"),
                or(
                  sql`${npAgentNotifications.nextAttemptAt} is null`,
                  lte(npAgentNotifications.nextAttemptAt, now()),
                ),
              ),
              and(
                eq(npAgentNotifications.state, "sending"),
                lte(npAgentNotifications.updatedAt, new Date(now().getTime() - 15_000)),
              ),
            ),
          ),
        )
        .orderBy(asc(npAgentNotifications.id))
        .limit(BATCH);
      if (setting || sources.length || pending.length)
        await db
          .insert(npSettings)
          .values({
            siteId: input.siteId,
            key: CURSORS,
            value: {
              local: sources.length === BATCH ? sources.at(-1)!.id : null,
              pending: pending.length === BATCH ? pending.at(-1)!.id : null,
            },
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: [npSettings.siteId, npSettings.key],
            set: {
              value: {
                local: sources.length === BATCH ? sources.at(-1)!.id : null,
                pending: pending.length === BATCH ? pending.at(-1)!.id : null,
              },
              updatedAt: now(),
            },
          });
      return { sources, pending };
    });
    let failed = false;
    for (const row of current.sources) {
      try {
        await queue({ db: getDb(), siteId: input.siteId, notificationId: row.id });
      } catch {
        failed = true;
      }
    }
    // Includes newly persisted rows on the next bounded sweep; no uncommitted-row enqueue.
    for (const row of current.pending) {
      try {
        if (
          !(await enqueueJob("agent:notificationSend", {
            siteId: input.siteId,
            notificationId: row.id,
            expectedAttempt: row.attempts,
          }))
        )
          failed = true;
      } catch {
        failed = true;
      }
    }
    if (failed) unavailable();
  }

  async function list(
    input: Parameters<NpAgentNotificationDeliveryServiceV1["list"]>[0],
  ): Promise<NpAgentIncidentNotificationDeliveriesV1> {
    canonicalBodySiteId(input.siteId, "delivery.siteId");
    canonicalBodyUuid(input.incidentId, "delivery.incidentId");
    const db = input.transaction ?? getDb();
    await options.reads.get({ incidentId: input.incidentId }, { ...input, transaction: db });
    const bind = async () =>
      codec.mac(
        serializeAgentCanonicalJson({
          siteId: input.siteId,
          incidentId: input.incidentId,
          sessionId: input.actor.sessionId,
          authorization: await npResolveAgentStaffSessionAuthorizationV1(
            db,
            input.siteId,
            input.actor,
            now(),
          ),
        }),
      );
    const binding = await bind();
    let after: { createdAt: string; id: string } | null = null;
    if (input.cursor) {
      try {
        const value = canonicalBodyRecord(
          codec.open(input.cursor),
          "delivery.cursor",
          ["binding", "expires", "after"],
          ["binding", "expires", "after"],
          { seen: new WeakSet<object>() },
        );
        if (value.binding !== binding) unavailable();
        canonicalBodyInteger(
          value.expires,
          "delivery.cursor.expires",
          now().getTime() + 1,
          now().getTime() + 900_000,
        );
        const position = canonicalBodyRecord(
          value.after,
          "delivery.cursor.after",
          ["createdAt", "id"],
          ["createdAt", "id"],
          { seen: new WeakSet<object>() },
        );
        after = {
          createdAt: canonicalBodyUtc(position.createdAt, "delivery.cursor.time"),
          id: canonicalBodyUuid(position.id, "delivery.cursor.id"),
        };
      } catch {
        unavailable("INCIDENT_DELIVERIES_CURSOR_INVALID");
      }
    }
    const rows = await db
      .select()
      .from(npAgentNotifications)
      .where(
        and(
          eq(npAgentNotifications.siteId, input.siteId),
          eq(npAgentNotifications.incidentId, input.incidentId),
          sql`${npAgentNotifications.channel}<>'admin'`,
          after
            ? sql`(${npAgentNotifications.createdAt},${npAgentNotifications.id}) < (${after.createdAt}::timestamptz,${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(npAgentNotifications.createdAt), desc(npAgentNotifications.id))
      .limit(21);
    const items: NpAgentIncidentNotificationDeliveriesV1["items"] = [];
    for (const row of rows.slice(0, 20)) {
      try {
        const receipt = await source(db, row);
        await visible(db, receipt.item, input);
        const facts = await db
          .select()
          .from(npAgentIncidentTimeline)
          .where(
            and(
              eq(npAgentIncidentTimeline.siteId, row.siteId),
              eq(npAgentIncidentTimeline.incidentId, row.incidentId!),
              eq(npAgentIncidentTimeline.sourceId, row.id),
            ),
          )
          .orderBy(asc(npAgentIncidentTimeline.sequence))
          .limit(6);
        const { result, unresolvedAmbiguity } = await npRequireNotificationDeliveryAttemptHistoryV1(
          row,
          facts,
        );
        items.push({
          notificationId: row.id,
          connectionId: row.connectionId!,
          channel: row.channel as NpAgentExternalNotificationChannelV1,
          incidentVersion: row.transitionVersion,
          state: row.state as NpAgentIncidentNotificationDeliveriesV1["items"][number]["state"],
          outcome:
            row.state === "sending" || unresolvedAmbiguity
              ? "unknown"
              : row.state === "sent"
                ? "confirmed"
                : row.state === "suppressed"
                  ? "suppressed"
                  : result?.state === "ambiguous"
                    ? "unknown"
                    : result
                      ? "not-sent"
                      : "pending",
          attempts: row.attempts,
          lastErrorCode: row.lastErrorCode,
          nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
          sentAt: row.sentAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        });
      } catch {
        /* Hidden or unverifiable rows never leak identifiers or inferred counts. */
      }
    }
    const last = rows.slice(0, 20).at(-1);
    await options.reads.get({ incidentId: input.incidentId }, { ...input, transaction: db });
    if ((await bind()) !== binding) unavailable("NOTIFICATION_AUTHORITY_REVOKED");
    return npRequireAgentIncidentNotificationDeliveriesV1({
      schemaVersion: "np.agent-incident-notification-deliveries.v1",
      incidentId: input.incidentId,
      items,
      nextCursor:
        rows.length > 20 && last
          ? codec.seal({
              binding,
              expires: now().getTime() + 900_000,
              after: { createdAt: last.createdAt.toISOString(), id: last.id },
            })
          : null,
    });
  }
  return { queue, process, reconcile, list };
}
