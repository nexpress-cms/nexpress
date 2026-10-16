import { createHash } from "node:crypto";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { canonicalBodyInteger } from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentNotificationDeliveryCanonical,
  npDigestAgentNotificationDeliveryCanonical,
} from "../agent-contract/canonical-notification-policy.js";
import { npAgentNotificationDeliveryLimitsV1 } from "../agent-contract/notification-delivery-contract.js";
import type { NpAgentExternalNotificationChannelV1 } from "../agent-contract/notification-delivery-contract.js";
import type {
  NpAgentJsonObject,
  NpAgentNotificationDeliveryCanonicalV1,
} from "../agent-contract/types.js";
import type { npAgentNotifications } from "../db/schema/agent.js";
import type { NpAgentNotificationConnectionSnapshotV1 } from "./connection-service.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Row = typeof npAgentNotifications.$inferSelect;
type ExternalBody = Extract<
  NpAgentNotificationDeliveryCanonicalV1,
  { channel: NpAgentExternalNotificationChannelV1 }
>;
const LIMITS = npAgentNotificationDeliveryLimitsV1;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function unavailable(code = "NOTIFICATION_DELIVERY_UNAVAILABLE"): never {
  throw new NpAgentGatewayError(code, 409, "External notification delivery is unavailable.");
}

/** Private shared evidence validation. No credential, adapter or transport I/O. */
export function npNotificationDeliverySnapshotV1(
  row: Row,
): NpAgentNotificationConnectionSnapshotV1 {
  if (
    !row.connectionId ||
    !row.connectionConfigSnapshotId ||
    !row.adapterId ||
    !row.adapterContractVersion ||
    !row.adapterFingerprint ||
    !row.connectionConfigVersion ||
    !row.connectionConfigHash ||
    !row.accountSubjectKeyId ||
    !row.accountSubjectDigest ||
    !row.destinationKeyId ||
    !row.destinationDescriptor ||
    !row.destinationFingerprint
  )
    unavailable("NOTIFICATION_EVIDENCE_INVALID");
  return {
    siteId: row.siteId,
    connectionId: row.connectionId,
    configSnapshotId: row.connectionConfigSnapshotId,
    adapterId: row.adapterId,
    adapterContractVersion: row.adapterContractVersion,
    adapterFingerprint: row.adapterFingerprint,
    configVersion: row.connectionConfigVersion,
    configHash: row.connectionConfigHash,
    accountSubjectKeyId: row.accountSubjectKeyId,
    accountSubjectDigest: row.accountSubjectDigest,
    destinationKeyId: row.destinationKeyId,
    destinationDescriptor: row.destinationDescriptor,
    destinationFingerprint: row.destinationFingerprint,
  };
}
export function npNotificationDeliveryBodyV1(
  row: Row,
  result: ExternalBody["result"],
  observedAt: Date,
): ExternalBody {
  const s = npNotificationDeliverySnapshotV1(row);
  const parsed = npRequireAgentNotificationDeliveryCanonical({
    schemaVersion: "np.agent-notification-delivery.v1",
    siteId: row.siteId,
    notificationId: row.id,
    channel: row.channel,
    source: {
      incidentId: row.incidentId,
      runId: row.runId,
      actionId: row.actionId,
      transitionVersion: row.transitionVersion,
    },
    deduplicationKey: row.deduplicationKey,
    payloadRedacted: row.payloadRedacted,
    attempt: row.attempts,
    adapter: {
      id: s.adapterId,
      contractVersion: s.adapterContractVersion,
      fingerprint: s.adapterFingerprint,
      idempotency: row.adapterIdempotency,
    },
    connection: {
      id: s.connectionId,
      configSnapshotId: s.configSnapshotId,
      configVersion: s.configVersion,
      configHash: s.configHash,
      accountSubjectKeyId: s.accountSubjectKeyId,
      accountSubjectDigest: s.accountSubjectDigest,
      destinationKeyId: s.destinationKeyId,
      destinationFingerprint: s.destinationFingerprint,
    },
    result,
    observedAt: observedAt.toISOString(),
  });
  if (parsed.channel === "admin") unavailable();
  return parsed;
}

export function npNotificationDeliveryImmutableV1(row: Row) {
  return {
    siteId: row.siteId,
    id: row.id,
    channel: row.channel,
    incidentId: row.incidentId,
    runId: row.runId,
    actionId: row.actionId,
    transitionVersion: row.transitionVersion,
    connection: npNotificationDeliverySnapshotV1(row),
    idempotency: row.adapterIdempotency,
    deduplicationKey: row.deduplicationKey,
    payloadRedacted: row.payloadRedacted,
    createdAt: row.createdAt.toISOString(),
  };
}
/** A persisted state is useful only if its immutable receipt and retry clock agree. */
export async function npRequireNotificationDeliveryLedgerV1(
  row: Row,
): Promise<ExternalBody["result"] | null> {
  const bad = () => unavailable("NOTIFICATION_EVIDENCE_INVALID");
  canonicalBodyInteger(row.attempts, "notification.attempts", 0, LIMITS.maxAttempts);
  if (
    !row.incidentId ||
    row.runId ||
    row.actionId ||
    !Number.isFinite(row.updatedAt.getTime()) ||
    row.updatedAt < row.createdAt ||
    !["queued", "sending", "sent", "failed", "suppressed"].includes(row.state)
  )
    bad();
  // Validate frozen identity even before the first result exists.
  npNotificationDeliveryBodyV1(
    { ...row, attempts: 1 },
    { state: "retryable_not_sent", errorCode: "DELIVERY_NOT_DISPATCHED" },
    row.createdAt,
  );
  if (!row.deliveryDigestBody) {
    if (
      row.deliveryResultDigest ||
      row.lastErrorCode ||
      row.providerMessageId ||
      row.nextAttemptAt ||
      row.sentAt ||
      !(
        (row.state === "queued" && row.attempts === 0) ||
        (row.state === "sending" && row.attempts === 1)
      )
    )
      bad();
    return null;
  }
  const stored = npRequireAgentNotificationDeliveryCanonical(row.deliveryDigestBody);
  if (stored.channel === "admin") return bad();
  if (
    !same(
      stored,
      npNotificationDeliveryBodyV1(
        { ...row, attempts: stored.attempt },
        stored.result,
        new Date(stored.observedAt),
      ),
    ) ||
    (await npDigestAgentNotificationDeliveryCanonical(stored)) !== row.deliveryResultDigest
  )
    bad();
  const result = stored.result;
  if (row.state === "sending") {
    if (
      stored.attempt !== row.attempts - 1 ||
      !["retryable_not_sent", "ambiguous"].includes(result.state) ||
      (result.state === "ambiguous" && row.adapterIdempotency !== "enforced") ||
      row.nextAttemptAt ||
      row.sentAt ||
      row.providerMessageId ||
      row.updatedAt < new Date(stored.observedAt)
    )
      bad();
  } else {
    if (stored.attempt !== row.attempts || row.updatedAt.toISOString() !== stored.observedAt) bad();
    if (row.state === "sent") {
      if (
        result.state !== "confirmed" ||
        row.sentAt?.toISOString() !== stored.observedAt ||
        row.lastErrorCode ||
        row.nextAttemptAt
      )
        bad();
    } else {
      if (result.state === "confirmed" || row.sentAt || row.providerMessageId) bad();
      if (row.state === "queued") {
        if (
          row.attempts >= LIMITS.maxAttempts ||
          result.state === "permanent_failure" ||
          (result.state === "ambiguous" && row.adapterIdempotency !== "enforced") ||
          row.nextAttemptAt?.getTime() !==
            Date.parse(stored.observedAt) + LIMITS.retryDelaySeconds[row.attempts - 1] * 1000
        )
          bad();
      } else if (
        row.nextAttemptAt ||
        (row.state === "suppressed" && result.state !== "permanent_failure") ||
        (row.state === "failed" &&
          (result.state === "retryable_not_sent" ||
            (result.state === "ambiguous" && row.adapterIdempotency === "enforced")) &&
          row.attempts < LIMITS.maxAttempts)
      )
        bad();
    }
  }
  if (result.state !== "confirmed" && row.lastErrorCode !== result.errorCode) bad();
  return result;
}

export function npNotificationTimelineFingerprintV1(
  schemaVersion: string,
  details: NpAgentJsonObject,
): string {
  return `cj1:sha256:${createHash("sha256").update(schemaVersion).update("\0").update(serializeAgentCanonicalJson(details)).digest("base64url")}`;
}

export const NP_NOTIFICATION_ROUTING_EXPIRED_V1 = "np.agent-notification-routing-expired.v1";
