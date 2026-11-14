import {
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  npAgentProviderFailureErrorClassesV1,
  parseAgentProviderUsageV1,
} from "./canonical-provider.js";
import {
  parseCanonicalAscii,
  parseCanonicalIdentifier,
  SIGNED_32_BIT_MAXIMUM,
} from "./canonical-runtime-primitives.js";
import { npAgentEventKinds } from "./types.js";
import type { NpAgentRunV1 } from "./wire-contract.js";

export const npAgentActivityProviderCallLimitV1 = 20;
const eventKinds = new Set<string>(npAgentEventKinds);
const callStates = [
  "reserved",
  "in_flight",
  "succeeded",
  "failed",
  "ambiguous",
  "cancelled",
] as const;
const dispatchStates = ["not-dispatched", "dispatched", "unknown"] as const;
const errorClasses = new Set<string>(npAgentProviderFailureErrorClassesV1);
const triggerKinds = ["event", "schedule", "manual"] as const;

function parseTrigger(value: unknown, path: string, inspection: CanonicalBodyInspectionState) {
  if (value === null) return null;
  const keys = ["id", "kind", "eventKind", "scheduledFor"];
  const row = canonicalBodyRecord(value, path, keys, keys, inspection);
  const kind = canonicalBodyEnum<(typeof triggerKinds)[number]>(
    row.kind,
    path,
    new Set(triggerKinds),
  );
  const eventKind =
    row.eventKind === null
      ? null
      : canonicalBodyEnum<(typeof npAgentEventKinds)[number]>(row.eventKind, path, eventKinds);
  const scheduledFor = row.scheduledFor === null ? null : canonicalBodyUtc(row.scheduledFor, path);
  if (
    (kind === "event") !== (eventKind !== null) ||
    (kind === "schedule") !== (scheduledFor !== null)
  )
    failCanonicalBody("invalid-field", path, "trigger metadata must match its kind");
  return { id: canonicalBodyUuid(row.id, path), kind, eventKind, scheduledFor };
}

function parseProviderCall(value: unknown, path: string, inspection: CanonicalBodyInspectionState) {
  const keys = [
    "sequence",
    "provider",
    "model",
    "state",
    "dispatchState",
    "errorClass",
    "latencyMs",
    "usage",
    "startedAt",
    "finishedAt",
  ];
  const row = canonicalBodyRecord(value, path, keys, keys, inspection);
  const state = canonicalBodyEnum<(typeof callStates)[number]>(
    row.state,
    path,
    new Set(callStates),
  );
  const dispatchState = canonicalBodyEnum<(typeof dispatchStates)[number]>(
    row.dispatchState,
    path,
    new Set(dispatchStates),
  );
  const latencyMs =
    row.latencyMs === null
      ? null
      : canonicalBodyInteger(row.latencyMs, path, 0, SIGNED_32_BIT_MAXIMUM);
  const errorClass =
    row.errorClass === null
      ? null
      : canonicalBodyEnum<(typeof npAgentProviderFailureErrorClassesV1)[number]>(
          row.errorClass,
          path,
          errorClasses,
        );
  const usage =
    row.usage === null ? null : parseAgentProviderUsageV1(row.usage, `${path}.usage`, inspection);
  const startedAt = row.startedAt === null ? null : canonicalBodyUtc(row.startedAt, path);
  const finishedAt = row.finishedAt === null ? null : canonicalBodyUtc(row.finishedAt, path);
  const terminal = state !== "reserved" && state !== "in_flight";
  if (
    terminal !== (finishedAt !== null) ||
    terminal !== (latencyMs !== null) ||
    (state === "reserved" && (startedAt !== null || dispatchState !== "not-dispatched")) ||
    ((state === "in_flight" || state === "ambiguous") && dispatchState !== "unknown") ||
    (dispatchState === "unknown" && state !== "in_flight" && state !== "ambiguous") ||
    (dispatchState !== "not-dispatched" && startedAt === null) ||
    (startedAt !== null && finishedAt !== null && finishedAt < startedAt) ||
    (state === "failed" || state === "cancelled" || state === "ambiguous") !==
      (errorClass !== null) ||
    (state === "ambiguous" && errorClass !== "timeout" && errorClass !== "unknown") ||
    (dispatchState === "dispatched") !== (usage !== null) ||
    (state === "succeeded" && usage === null)
  )
    failCanonicalBody("invalid-field", path, "provider call evidence must match its state");
  return {
    sequence: canonicalBodyInteger(row.sequence, path, 1, SIGNED_32_BIT_MAXIMUM),
    provider: parseCanonicalIdentifier(row.provider, path),
    model: parseCanonicalAscii(row.model, path),
    state,
    dispatchState,
    errorClass,
    latencyMs,
    usage,
    startedAt,
    finishedAt,
  };
}

export function parseActivityRuntimeDiagnosticsV1(value: unknown, run: NpAgentRunV1) {
  const path = "agent.activity.runtimeDiagnostics";
  if (run.origin !== "runtime") failCanonicalBody("invalid-field", path, "requires a Runtime run");
  if (value === null) return null;
  const inspection = { seen: new WeakSet<object>() };
  const keys = ["trigger", "retryAt", "providerCalls", "moreProviderCalls"];
  const row = canonicalBodyRecord(value, path, keys, keys, inspection);
  const retryAt = row.retryAt === null ? null : canonicalBodyUtc(row.retryAt, `${path}.retryAt`);
  if (
    (run.state === "waiting_retry") !== (retryAt !== null) ||
    (retryAt !== null && (retryAt < run.queuedAt || retryAt >= run.deadlineAt))
  )
    failCanonicalBody(
      "invalid-field",
      `${path}.retryAt`,
      "must match the Run retry state and deadline",
    );
  const providerCalls = canonicalBodyArray(
    row.providerCalls,
    `${path}.providerCalls`,
    npAgentActivityProviderCallLimitV1,
    inspection,
  ).map((call, index) => parseProviderCall(call, `${path}.providerCalls[${index}]`, inspection));
  if (
    providerCalls.some(
      (call, index) => index > 0 && providerCalls[index - 1].sequence <= call.sequence,
    )
  )
    failCanonicalBody(
      "invalid-field",
      `${path}.providerCalls`,
      "must use descending unique sequences",
    );
  if (
    typeof row.moreProviderCalls !== "boolean" ||
    (row.moreProviderCalls && providerCalls.length !== npAgentActivityProviderCallLimitV1)
  )
    failCanonicalBody(
      "invalid-field",
      `${path}.moreProviderCalls`,
      "requires a full page when more calls remain",
    );
  return {
    trigger: parseTrigger(row.trigger, `${path}.trigger`, inspection),
    retryAt,
    providerCalls,
    moreProviderCalls: row.moreProviderCalls,
  };
}

export type NpAgentActivityRuntimeDiagnosticsV1 = NonNullable<
  ReturnType<typeof parseActivityRuntimeDiagnosticsV1>
>;
