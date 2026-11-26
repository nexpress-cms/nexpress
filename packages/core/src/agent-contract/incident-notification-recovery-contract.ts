import {
  canonicalBodyRecord,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

/** Local recording evidence only; pending never claims a running worker or external delivery. */
export interface NpAgentIncidentNotificationRecoveryV1 {
  state: "pending" | "sent" | "failed";
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCode: "NOTIFICATION_RECORDING_FAILED" | "SOURCE_EVIDENCE_INVALID" | null;
}

export function npRequireAgentIncidentNotificationRecoveryV1(
  value: unknown,
): NpAgentIncidentNotificationRecoveryV1 {
  const path = "incident.notificationRecovery";
  const keys = ["state", "attempts", "lastAttemptAt", "nextAttemptAt", "lastErrorCode"];
  const r = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, path, 4096), path, keys, keys, {
    seen: new WeakSet(),
  });
  const state = canonicalBodyEnum<NpAgentIncidentNotificationRecoveryV1["state"]>(
    r.state,
    path,
    new Set(["pending", "sent", "failed"]),
  );
  const attempts = canonicalBodyInteger(r.attempts, path, 0, 5);
  const lastAttemptAt = r.lastAttemptAt === null ? null : canonicalBodyUtc(r.lastAttemptAt, path);
  const nextAttemptAt = r.nextAttemptAt === null ? null : canonicalBodyUtc(r.nextAttemptAt, path);
  const lastErrorCode =
    r.lastErrorCode === null
      ? null
      : canonicalBodyEnum<NonNullable<NpAgentIncidentNotificationRecoveryV1["lastErrorCode"]>>(
          r.lastErrorCode,
          path,
          new Set(["NOTIFICATION_RECORDING_FAILED", "SOURCE_EVIDENCE_INVALID"]),
        );
  if (
    (attempts === 0) !== (lastAttemptAt === null) ||
    (state === "pending") !== (nextAttemptAt !== null) ||
    (state === "pending" && (attempts >= 5 || lastErrorCode === "SOURCE_EVIDENCE_INVALID")) ||
    (state === "sent" && (attempts === 0 || lastErrorCode !== null)) ||
    (state === "failed" &&
      (attempts === 0 ||
        lastErrorCode === null ||
        (attempts !== 5 && lastErrorCode !== "SOURCE_EVIDENCE_INVALID"))) ||
    (attempts === 0 && lastErrorCode !== null) ||
    (state === "pending" && attempts > 0 && lastErrorCode !== "NOTIFICATION_RECORDING_FAILED") ||
    (lastAttemptAt !== null && nextAttemptAt !== null && nextAttemptAt <= lastAttemptAt)
  )
    failCanonicalBody("invalid-field", path, "Invalid notification recovery state");
  return { state, attempts, lastAttemptAt, nextAttemptAt, lastErrorCode };
}
