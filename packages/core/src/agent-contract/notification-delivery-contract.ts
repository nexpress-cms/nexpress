import {
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyRecord,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentNotificationChannel } from "./types.js";

export type NpAgentExternalNotificationChannelV1 = Exclude<NpAgentNotificationChannel, "admin">;
export const npAgentNotificationDeliveryLimitsV1 = Object.freeze({
  maxAttempts: 5,
  attemptTimeoutSeconds: 10,
  retryDelaySeconds: Object.freeze([30, 120, 600, 1800]),
});
export type NpAgentNotificationDeliveryResultV1 =
  | { state: "confirmed"; providerMessageId: string | null }
  | { state: "retryable_not_sent"; errorCode: string }
  | { state: "permanent_failure"; errorCode: string }
  | { state: "ambiguous"; errorCode: string };

/** Transport receipts are data, never exception messages or recipient instructions. */
export function npRequireAgentNotificationDeliveryResultV1(
  value: unknown,
): NpAgentNotificationDeliveryResultV1 {
  const input = cloneCanonicalRuntimeInput(value, "notification.result", 4096);
  const state =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? Object.getOwnPropertyDescriptor(input, "state")?.value
      : undefined;
  const keys = state === "confirmed" ? ["state", "providerMessageId"] : ["state", "errorCode"];
  const row = canonicalBodyRecord(input, "notification.result", keys, keys, {
    seen: new WeakSet<object>(),
  });
  if (row.state === "confirmed")
    return {
      state: "confirmed",
      providerMessageId:
        row.providerMessageId === null
          ? null
          : canonicalBodyAscii(row.providerMessageId, "notification.receipt", 256),
    };
  const outcome = canonicalBodyEnum<
    Exclude<NpAgentNotificationDeliveryResultV1["state"], "confirmed">
  >(
    row.state,
    "notification.result.state",
    new Set(["retryable_not_sent", "permanent_failure", "ambiguous"]),
  );
  const errorCode = canonicalBodyAscii(row.errorCode, "notification.errorCode", 64);
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(errorCode))
    failCanonicalBody("invalid-field", "notification.errorCode", "Invalid safe delivery code");
  return { state: outcome, errorCode };
}
