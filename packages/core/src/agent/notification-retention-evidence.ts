import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentNotificationDeliveryCanonical,
  npRequireAgentNotificationDeliveryCanonical,
} from "../agent-contract/canonical-notification-policy.js";
import { npAgentNotificationDeliveryLimitsV1 } from "../agent-contract/notification-delivery-contract.js";
import { NpAgentContractError } from "../agent-contract/contract.js";
import type { npAgentIncidentTimeline, npAgentNotifications } from "../db/schema/agent.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import {
  npNotificationTimelineFingerprintV1,
  npRequireNotificationDeliveryLedgerV1,
} from "./notification-delivery-evidence.js";

type Notification = typeof npAgentNotifications.$inferSelect;
type Timeline = typeof npAgentIncidentTimeline.$inferSelect;
const ROUTING = "np.agent-notification-routing.v1";
const ATTEMPT = "np.agent-notification-attempt.v1";
const knownSchema = (value: unknown) => value === ROUTING || value === ATTEMPT;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);

/** Validate a complete source/routing/attempt group, never infer a known effect
 * from terminal row state alone. The caller validates local receipts and ages,
 * holds the reference fence and deletes only the complete selected group. */
export async function npAgentNotificationRetentionEvidenceV1(
  notifications: Notification[],
  timeline: Timeline[],
): Promise<boolean> {
  try {
    const locals = notifications.filter((row) => row.channel === "admin");
    const external = notifications.filter((row) => row.channel !== "admin");
    if (
      timeline.some(
        (entry) =>
          entry.kind === "notification" &&
          notifications.some((row) => row.id === entry.sourceId) &&
          !knownSchema(entry.details.schemaVersion),
      )
    )
      return false;
    const facts = timeline.filter((row) => knownSchema(row.details.schemaVersion));
    for (const row of external) {
      const result = await npRequireNotificationDeliveryLedgerV1(row);
      if (
        !["sent", "failed", "suppressed"].includes(row.state) ||
        !result ||
        result.state === "ambiguous"
      )
        return false;
      const local = locals.find((source) => source.id === row.payloadRedacted.sourceNotificationId);
      const recipientFingerprint = row.payloadRedacted.recipientFingerprint;
      if (
        !local ||
        row.siteId !== local.siteId ||
        row.incidentId !== local.incidentId ||
        row.transitionVersion !== local.transitionVersion ||
        row.createdAt < local.createdAt ||
        typeof recipientFingerprint !== "string" ||
        !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(recipientFingerprint) ||
        !same(row.payloadRedacted, {
          ...local.payloadRedacted,
          sourceNotificationId: local.id,
          recipientFingerprint,
        }) ||
        row.deduplicationKey !== `notification:${local.id}:${row.channel}:${row.connectionId}`
      )
        return false;
      const attempts = facts
        .filter((entry) => entry.details.schemaVersion === ATTEMPT && entry.sourceId === row.id)
        .sort((a, b) => a.sequence - b.sequence);
      if (attempts.length !== row.attempts) return false;
      let previous = row.createdAt;
      let ambiguous = false;
      for (const [index, entry] of attempts.entries()) {
        const receipt = npRequireAgentNotificationDeliveryCanonical({
          ...row.deliveryDigestBody,
          attempt: entry.details.attempt,
          result: entry.details.result,
          observedAt: entry.details.observedAt,
        });
        if (receipt.channel === "admin") return false;
        ambiguous ||= receipt.result.state === "ambiguous";
        if (ambiguous && result.state !== "confirmed") return false;
        const digest = await npDigestAgentNotificationDeliveryCanonical(receipt);
        const final = index === attempts.length - 1;
        const state = final ? row.state : "queued";
        const details = {
          notificationId: row.id,
          attempt: index + 1,
          state,
          result: receipt.result,
          deliveryResultDigest: digest,
          observedAt: entry.createdAt.toISOString(),
        };
        if (
          !same(entry.details, { schemaVersion: ATTEMPT, ...details }) ||
          entry.sourceFingerprint !== npNotificationTimelineFingerprintV1(ATTEMPT, details) ||
          entry.createdAt < previous ||
          entry.createdAt > row.updatedAt ||
          (final && digest !== row.deliveryResultDigest)
        )
          return false;
        // Reuse the sender's exact attempt/result/retry-clock consistency rules.
        await npRequireNotificationDeliveryLedgerV1({
          ...row,
          state,
          attempts: index + 1,
          deliveryDigestBody: receipt,
          deliveryResultDigest: digest,
          updatedAt: entry.createdAt,
          sentAt: state === "sent" ? entry.createdAt : null,
          providerMessageId: state === "sent" ? row.providerMessageId : null,
          lastErrorCode: receipt.result.state === "confirmed" ? null : receipt.result.errorCode,
          nextAttemptAt: final
            ? row.nextAttemptAt
            : new Date(
                entry.createdAt.getTime() +
                  npAgentNotificationDeliveryLimitsV1.retryDelaySeconds[index] * 1000,
              ),
        });
        previous = entry.createdAt;
      }
    }
    for (const local of locals) {
      const routes = external.filter(
        (row) => row.payloadRedacted.sourceNotificationId === local.id,
      );
      const markers = facts.filter(
        (entry) => entry.details.schemaVersion === ROUTING && entry.sourceId === local.id,
      );
      if (!routes.length && !markers.length) continue;
      if (routes.length > 8 || markers.length !== 1) return false;
      const marker = markers[0];
      const ids = marker.details.notificationIds;
      if (
        !Array.isArray(ids) ||
        !same([...ids].sort(), routes.map((row) => row.id).sort()) ||
        !same(marker.details, {
          schemaVersion: ROUTING,
          localNotificationId: local.id,
          notificationIds: ids,
        }) ||
        marker.createdAt < local.createdAt ||
        routes.some((row) => row.createdAt > marker.createdAt) ||
        marker.sourceFingerprint !==
          npNotificationTimelineFingerprintV1(ROUTING, {
            localNotificationId: local.id,
            notificationIds: ids,
          })
      )
        return false;
    }
    // No unrelated evidence can be swept into the disposable notification group.
    for (const entry of facts) {
      const source = notifications.find((row) => row.id === entry.sourceId);
      if (
        !source ||
        entry.siteId !== source.siteId ||
        entry.incidentId !== source.incidentId ||
        entry.kind !== "notification" ||
        entry.sourceKind !== "system" ||
        entry.eventId ||
        entry.signalId ||
        entry.runId ||
        entry.actionId ||
        entry.approvalId ||
        entry.providerCallId ||
        entry.auditEventId ||
        (entry.details.schemaVersion === ROUTING) !== (source.channel === "admin")
      )
        return false;
    }
    return true;
  } catch (error) {
    if (
      error instanceof NpAgentContractError ||
      error instanceof NpAgentGatewayError ||
      error instanceof RangeError
    )
      return false;
    throw error;
  }
}
