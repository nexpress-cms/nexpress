import {
  canonicalBodyArray,
  canonicalBodyCapabilityId,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { npAgentScopes, type NpAgentCapabilityId, type NpAgentScope } from "./types.js";

export const npAgentGuardianRuntimeRuleBoundsV1 = Object.freeze({
  windowMs: 600_000,
  maximumActivities: 100,
  repeatedProposalCount: 2,
  deniedCallCount: 5,
  admittedActionCount: 5,
  knownSettledCostMicros: 100_000,
});
export const npAgentGuardianRuntimeDetectorIdsV1 = [
  "guardian.repeated-proposals",
  "guardian.denied-scopes",
  "guardian.spend-velocity",
  "guardian.action-velocity",
] as const;
export type NpAgentGuardianRuntimeDetectorIdV1 =
  (typeof npAgentGuardianRuntimeDetectorIdsV1)[number];

export interface NpAgentGuardianRuntimeProviderResponseV1 {
  providerCallId: string;
  sequence: number;
  responseDigest: string;
}
/** Reservation accounting, not a claim that a conservative charge was actual spend. */
export type NpAgentGuardianRuntimeAccountingV1 =
  | {
      state: "unknown";
      costSource: "unknown";
      costMicros: null;
      budgetChargeCostMicros: number;
    }
  | {
      state: "settled";
      costSource: "provider" | "adapter-estimate";
      costMicros: number;
      budgetChargeCostMicros: number;
    }
  | {
      state: "released";
      costSource: null;
      costMicros: null;
      budgetChargeCostMicros: 0;
    };
export type NpAgentGuardianRuntimeFactV1 =
  | {
      kind: "proposal-repeated";
      capabilityId: NpAgentCapabilityId;
      proposalDigest: string;
      responses: [
        NpAgentGuardianRuntimeProviderResponseV1,
        NpAgentGuardianRuntimeProviderResponseV1,
      ];
    }
  | {
      kind: "scope-denied";
      capabilityId: NpAgentCapabilityId;
      missingScopes: NpAgentScope[];
      response: NpAgentGuardianRuntimeProviderResponseV1;
    }
  | {
      kind: "provider-cost";
      providerCallId: string;
      reservationId: string;
      sequence: number;
      requestDigest: string;
      responseDigest: string | null;
      phase: "ambiguous" | "expired" | "reconciled" | "late-reconciled";
      currency: "USD";
      accounting: NpAgentGuardianRuntimeAccountingV1;
    }
  | {
      kind: "action-admitted";
      actionId: string;
      sequence: number;
      actionDigest: string;
      capabilityId: NpAgentCapabilityId;
    };
/** Private committed source facts. Identifiers and digests are never execution input. */
export interface NpAgentGuardianRuntimeActivityV1 {
  schemaVersion: "np.agent-guardian-runtime-activity.v1";
  observationId: string;
  siteId: string;
  agentId: string;
  agentVersionId: string;
  runId: string;
  principalId: string;
  runAdmissionDigest: string;
  occurredAt: string;
  fact: NpAgentGuardianRuntimeFactV1;
}
export interface NpAgentGuardianRuntimeEventPayloadV1 {
  kind: "agent.runtime.activity.observed";
  receiptId: string;
  activity: NpAgentGuardianRuntimeActivityV1;
}
/** Shape only: the server must verify the body hash, retained key and domain-separated MAC. */
export interface NpAgentGuardianRuntimeSourceReceiptV1 {
  schemaVersion: "np.agent-guardian-runtime-receipt.v1";
  receiptId: string;
  keyId: string;
  bodyHash: string;
  sourceMac: string;
  activity: NpAgentGuardianRuntimeActivityV1;
}
/** Counts and USD micros in the retained cohort only; no total-spend or completeness claim. */
export interface NpAgentGuardianRuntimeAccountingSummaryV1 {
  reportedCallCount: number;
  reportedCostMicros: number;
  estimatedCallCount: number;
  estimatedCostMicros: number;
  knownCostMicros: number;
  unknownCallCount: number;
  unknownBudgetChargeMicros: number;
  releasedCallCount: number;
}
export interface NpAgentGuardianRuntimeEvidenceV1 {
  schemaVersion: "np.agent-guardian-runtime-evidence.v1";
  signalId: string;
  detectorId: NpAgentGuardianRuntimeDetectorIdV1;
  detectorVersion: 1;
  window: { startedAt: string; endedAt: string };
  basis:
    | "verified-repeated-proposal-pair"
    | "scope-denied-provider-calls"
    | "settled-provider-cost"
    | "admitted-actions";
  observedCount: number;
  countBasis: "at-least";
  assessment: "review-only";
  accounting: NpAgentGuardianRuntimeAccountingSummaryV1 | null;
  sourceDigest: string;
}
/** Private cohort identities are for proof construction, never an execution target or public wire. */
export interface NpAgentGuardianRuntimeRuleMatchV1 extends Omit<
  NpAgentGuardianRuntimeEvidenceV1,
  "schemaVersion" | "signalId" | "sourceDigest"
> {
  observationIds: string[];
}
export interface NpAgentGuardianRuntimeRuleInputV1 {
  siteId: string;
  agentId: string;
  windowStartedAt: string;
  activities: readonly NpAgentGuardianRuntimeActivityV1[];
}

const SCOPES = new Set<string>(npAgentScopes);
const SEQUENCE_MAXIMUM = 2_147_483_647;
const activityKeys = [
  "schemaVersion",
  "observationId",
  "siteId",
  "agentId",
  "agentVersionId",
  "runId",
  "principalId",
  "runAdmissionDigest",
  "occurredAt",
  "fact",
];
function response(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianRuntimeProviderResponseV1 {
  const keys = ["providerCallId", "sequence", "responseDigest"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    providerCallId: canonicalBodyUuid(row.providerCallId, path),
    sequence: canonicalBodyInteger(row.sequence, path, 1, SEQUENCE_MAXIMUM),
    responseDigest: canonicalBodySha256Digest(row.responseDigest, path),
  };
}
function accounting(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianRuntimeAccountingV1 {
  const keys = ["state", "costSource", "costMicros", "budgetChargeCostMicros"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const charge = canonicalBodyInteger(row.budgetChargeCostMicros, path, 0, Number.MAX_SAFE_INTEGER);
  if (row.state === "settled") {
    const cost = canonicalBodyInteger(row.costMicros, path, 0, Number.MAX_SAFE_INTEGER);
    if (charge !== cost)
      failCanonicalBody("invalid-field", path, "settled charge must equal its known cost");
    return {
      state: row.state,
      costSource: canonicalBodyEnum(
        row.costSource,
        path,
        new Set(["provider", "adapter-estimate"]),
      ),
      costMicros: cost,
      budgetChargeCostMicros: charge,
    };
  }
  if (row.costMicros !== null)
    failCanonicalBody("invalid-field", path, "unknown or released accounting cannot invent cost");
  if (row.state === "unknown")
    return {
      state: row.state,
      costSource: canonicalBodyEnum(row.costSource, path, new Set(["unknown"])),
      costMicros: null,
      budgetChargeCostMicros: charge,
    };
  if (row.state !== "released" || row.costSource !== null || charge !== 0)
    failCanonicalBody("invalid-field", path, "invalid released accounting");
  return { state: row.state, costSource: null, costMicros: null, budgetChargeCostMicros: 0 };
}
function fact(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianRuntimeFactV1 {
  const kind =
    typeof value === "object" && value !== null
      ? (Object.getOwnPropertyDescriptor(value, "kind")?.value as unknown)
      : undefined;
  const keys =
    kind === "proposal-repeated"
      ? ["kind", "capabilityId", "proposalDigest", "responses"]
      : kind === "scope-denied"
        ? ["kind", "capabilityId", "missingScopes", "response"]
        : kind === "action-admitted"
          ? ["kind", "actionId", "sequence", "actionDigest", "capabilityId"]
          : [
              "kind",
              "providerCallId",
              "reservationId",
              "sequence",
              "requestDigest",
              "responseDigest",
              "phase",
              "currency",
              "accounting",
            ];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  if (kind === "proposal-repeated") {
    const entries = canonicalBodyArray(row.responses, path, 2, state);
    if (entries.length !== 2)
      failCanonicalBody("invalid-field", path, "a repeated proposal requires two actual responses");
    const first = response(entries[0], path, state),
      second = response(entries[1], path, state);
    if (first.providerCallId === second.providerCallId || first.sequence >= second.sequence)
      failCanonicalBody("invalid-field", path, "repeated responses must be distinct and ordered");
    return {
      kind,
      capabilityId: canonicalBodyCapabilityId(row.capabilityId, path),
      proposalDigest: canonicalBodySha256Digest(row.proposalDigest, path),
      responses: [first, second],
    };
  }
  if (kind === "scope-denied") {
    const entries = canonicalBodyArray(row.missingScopes, path, SCOPES.size, state);
    if (entries.length === 0)
      failCanonicalBody("invalid-field", path, "a scope denial requires actual missing scopes");
    const missingScopes = entries.map((entry) =>
      canonicalBodyEnum<NpAgentScope>(entry, path, SCOPES),
    );
    if (missingScopes.some((scope, index) => index > 0 && missingScopes[index - 1] >= scope))
      failCanonicalBody("order", path, "missing scopes must be sorted and unique");
    return {
      kind,
      capabilityId: canonicalBodyCapabilityId(row.capabilityId, path),
      missingScopes,
      response: response(row.response, path, state),
    };
  }
  if (kind === "action-admitted")
    return {
      kind,
      actionId: canonicalBodyUuid(row.actionId, path),
      sequence: canonicalBodyInteger(row.sequence, path, 1, SEQUENCE_MAXIMUM),
      actionDigest: canonicalBodySha256Digest(row.actionDigest, path),
      capabilityId: canonicalBodyCapabilityId(row.capabilityId, path),
    };
  if (kind !== "provider-cost") failCanonicalBody("invalid-field", path, "unknown Runtime fact");
  const phase = canonicalBodyEnum<
    Extract<NpAgentGuardianRuntimeFactV1, { kind: "provider-cost" }>["phase"]
  >(row.phase, path, new Set(["ambiguous", "expired", "reconciled", "late-reconciled"]));
  const parsed = accounting(row.accounting, path, state);
  if ((phase === "ambiguous" || phase === "expired") !== (parsed.state === "unknown"))
    failCanonicalBody("invalid-field", path, "accounting must match its actual usage transition");
  return {
    kind,
    providerCallId: canonicalBodyUuid(row.providerCallId, path),
    reservationId: canonicalBodyUuid(row.reservationId, path),
    sequence: canonicalBodyInteger(row.sequence, path, 1, SEQUENCE_MAXIMUM),
    requestDigest: canonicalBodySha256Digest(row.requestDigest, path),
    responseDigest:
      row.responseDigest === null ? null : canonicalBodySha256Digest(row.responseDigest, path),
    phase,
    currency: canonicalBodyEnum(row.currency, path, new Set(["USD"])),
    accounting: parsed,
  };
}
export function npParseAgentGuardianRuntimeActivityV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianRuntimeActivityV1 {
  const row = canonicalBodyRecord(value, path, activityKeys, activityKeys, state);
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-runtime-activity.v1"]),
    ),
    observationId: canonicalBodyUuid(row.observationId, path),
    siteId: canonicalBodySiteId(row.siteId, path),
    agentId: canonicalBodyUuid(row.agentId, path),
    agentVersionId: canonicalBodyUuid(row.agentVersionId, path),
    runId: canonicalBodyUuid(row.runId, path),
    principalId: canonicalBodyUuid(row.principalId, path),
    runAdmissionDigest: canonicalBodySha256Digest(row.runAdmissionDigest, path),
    occurredAt: canonicalBodyUtc(row.occurredAt, path),
    fact: fact(row.fact, path, state),
  };
}
export function npRequireAgentGuardianRuntimeActivityV1(
  value: unknown,
): NpAgentGuardianRuntimeActivityV1 {
  return npParseAgentGuardianRuntimeActivityV1(
    cloneCanonicalRuntimeInput(value, "guardian.runtime.activity", 8192),
    "guardian.runtime.activity",
    { seen: new WeakSet<object>() },
  );
}
export function npParseAgentGuardianRuntimeEventPayloadV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianRuntimeEventPayloadV1 {
  const keys = ["kind", "receiptId", "activity"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const activity = npParseAgentGuardianRuntimeActivityV1(row.activity, path, state);
  const receiptId = canonicalBodyUuid(row.receiptId, path);
  if (receiptId !== activity.observationId)
    failCanonicalBody("invalid-field", path, "receipt must bind the exact source observation");
  return {
    kind: canonicalBodyEnum(row.kind, path, new Set(["agent.runtime.activity.observed"])),
    receiptId,
    activity,
  };
}
export function npRequireAgentGuardianRuntimeEventPayloadV1(
  value: unknown,
): NpAgentGuardianRuntimeEventPayloadV1 {
  return npParseAgentGuardianRuntimeEventPayloadV1(
    cloneCanonicalRuntimeInput(value, "guardian.runtime.event", 10_240),
    "guardian.runtime.event",
    { seen: new WeakSet<object>() },
  );
}
export function npRequireAgentGuardianRuntimeSourceReceiptV1(
  value: unknown,
): NpAgentGuardianRuntimeSourceReceiptV1 {
  const path = "guardian.runtime.receipt";
  const state = { seen: new WeakSet<object>() };
  const keys = ["schemaVersion", "receiptId", "keyId", "bodyHash", "sourceMac", "activity"];
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 12_288),
    path,
    keys,
    keys,
    state,
  );
  const activity = npParseAgentGuardianRuntimeActivityV1(row.activity, path, state);
  const receiptId = canonicalBodyUuid(row.receiptId, path);
  if (
    receiptId !== activity.observationId ||
    typeof row.keyId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(row.keyId) ||
    typeof row.sourceMac !== "string" ||
    !/^hmac-sha256:[A-Za-z0-9_-]{43}$/u.test(row.sourceMac)
  )
    failCanonicalBody("invalid-field", path, "invalid source receipt binding");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-runtime-receipt.v1"]),
    ),
    receiptId,
    keyId: row.keyId,
    bodyHash: canonicalBodySha256Digest(row.bodyHash, path),
    sourceMac: row.sourceMac,
    activity,
  };
}

function windowStart(value: unknown, path: string): string {
  const at = canonicalBodyUtc(value, path);
  if (Date.parse(at) % npAgentGuardianRuntimeRuleBoundsV1.windowMs !== 0)
    failCanonicalBody(
      "invalid-field",
      path,
      "window must start at a fixed UTC ten-minute boundary",
    );
  return at;
}
function sum(left: number, right: number, path: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result))
    failCanonicalBody("limit", path, "cohort accounting exceeds safe integer bounds");
  return result;
}
export function npParseAgentGuardianRuntimeAccountingSummaryV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianRuntimeAccountingSummaryV1 {
  const keys = [
    "reportedCallCount",
    "reportedCostMicros",
    "estimatedCallCount",
    "estimatedCostMicros",
    "knownCostMicros",
    "unknownCallCount",
    "unknownBudgetChargeMicros",
    "releasedCallCount",
  ];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const result: NpAgentGuardianRuntimeAccountingSummaryV1 = {
    reportedCallCount: canonicalBodyInteger(row.reportedCallCount, path, 0, 100),
    reportedCostMicros: canonicalBodyInteger(
      row.reportedCostMicros,
      path,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    estimatedCallCount: canonicalBodyInteger(row.estimatedCallCount, path, 0, 100),
    estimatedCostMicros: canonicalBodyInteger(
      row.estimatedCostMicros,
      path,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    knownCostMicros: canonicalBodyInteger(row.knownCostMicros, path, 0, Number.MAX_SAFE_INTEGER),
    unknownCallCount: canonicalBodyInteger(row.unknownCallCount, path, 0, 100),
    unknownBudgetChargeMicros: canonicalBodyInteger(
      row.unknownBudgetChargeMicros,
      path,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    releasedCallCount: canonicalBodyInteger(row.releasedCallCount, path, 0, 100),
  };
  if (
    result.knownCostMicros !== sum(result.reportedCostMicros, result.estimatedCostMicros, path) ||
    (result.reportedCallCount === 0 && result.reportedCostMicros !== 0) ||
    (result.estimatedCallCount === 0 && result.estimatedCostMicros !== 0) ||
    (result.unknownCallCount === 0 && result.unknownBudgetChargeMicros !== 0)
  )
    failCanonicalBody("invalid-field", path, "inconsistent bounded accounting summary");
  return result;
}
const bases: Record<NpAgentGuardianRuntimeDetectorIdV1, NpAgentGuardianRuntimeEvidenceV1["basis"]> =
  {
    "guardian.repeated-proposals": "verified-repeated-proposal-pair",
    "guardian.denied-scopes": "scope-denied-provider-calls",
    "guardian.spend-velocity": "settled-provider-cost",
    "guardian.action-velocity": "admitted-actions",
  };
export function npRequireAgentGuardianRuntimeEvidenceV1(
  value: unknown,
): NpAgentGuardianRuntimeEvidenceV1 {
  const path = "guardian.runtime.evidence",
    state = { seen: new WeakSet<object>() };
  const keys = [
    "schemaVersion",
    "signalId",
    "detectorId",
    "detectorVersion",
    "window",
    "basis",
    "observedCount",
    "countBasis",
    "assessment",
    "accounting",
    "sourceDigest",
  ];
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 8192),
    path,
    keys,
    keys,
    state,
  );
  const rawWindow = canonicalBodyRecord(
    row.window,
    path,
    ["startedAt", "endedAt"],
    ["startedAt", "endedAt"],
    state,
  );
  const startedAt = windowStart(rawWindow.startedAt, path),
    endedAt = canonicalBodyUtc(rawWindow.endedAt, path);
  const detectorId = canonicalBodyEnum<NpAgentGuardianRuntimeDetectorIdV1>(
    row.detectorId,
    path,
    new Set(npAgentGuardianRuntimeDetectorIdsV1),
  );
  const observedCount = canonicalBodyInteger(row.observedCount, path, 1, 100);
  const accountingSummary =
    row.accounting === null
      ? null
      : npParseAgentGuardianRuntimeAccountingSummaryV1(row.accounting, path, state);
  if (
    endedAt < startedAt ||
    Date.parse(endedAt) >= Date.parse(startedAt) + npAgentGuardianRuntimeRuleBoundsV1.windowMs ||
    row.basis !== bases[detectorId] ||
    (detectorId === "guardian.spend-velocity"
      ? accountingSummary === null ||
        accountingSummary.knownCostMicros <
          npAgentGuardianRuntimeRuleBoundsV1.knownSettledCostMicros ||
        observedCount !==
          accountingSummary.reportedCallCount +
            accountingSummary.estimatedCallCount +
            accountingSummary.unknownCallCount +
            accountingSummary.releasedCallCount
      : accountingSummary !== null ||
        observedCount !== (detectorId === "guardian.repeated-proposals" ? 2 : 5))
  )
    failCanonicalBody("invalid-field", path, "evidence must match its fixed bounded review rule");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-runtime-evidence.v1"]),
    ),
    signalId: canonicalBodyUuid(row.signalId, path),
    detectorId,
    detectorVersion: canonicalBodyInteger(row.detectorVersion, path, 1, 1) as 1,
    window: { startedAt, endedAt },
    basis: bases[detectorId],
    observedCount,
    countBasis: canonicalBodyEnum(row.countBasis, path, new Set(["at-least"])),
    assessment: canonicalBodyEnum(row.assessment, path, new Set(["review-only"])),
    accounting: accountingSummary,
    sourceDigest: canonicalBodySha256Digest(row.sourceDigest, path),
  };
}

type CostActivity = NpAgentGuardianRuntimeActivityV1 & {
  fact: Extract<NpAgentGuardianRuntimeFactV1, { kind: "provider-cost" }>;
};
function binding(activity: NpAgentGuardianRuntimeActivityV1): string {
  return serializeAgentCanonicalJson({
    runId: activity.runId,
    agentVersionId: activity.agentVersionId,
    principalId: activity.principalId,
    runAdmissionDigest: activity.runAdmissionDigest,
  });
}
function costPhase(phase: CostActivity["fact"]["phase"]): number {
  return phase === "ambiguous" ? 0 : phase === "expired" ? 1 : 2;
}
/** Input must already be receipt-authenticated by the server. Parsing is not source authentication.
 * Fixed UTC windows and lower bounds do not classify attack truth or grant response authority.
 */
export function npEvaluateAgentGuardianRuntimeRulesV1(
  value: unknown,
): NpAgentGuardianRuntimeRuleMatchV1[] {
  const path = "guardian.runtime.rules",
    state = { seen: new WeakSet<object>() };
  const keys = ["siteId", "agentId", "windowStartedAt", "activities"];
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 524_288),
    path,
    keys,
    keys,
    state,
  );
  const siteId = canonicalBodySiteId(row.siteId, path),
    agentId = canonicalBodyUuid(row.agentId, path),
    startedAt = windowStart(row.windowStartedAt, path);
  const end = Date.parse(startedAt) + npAgentGuardianRuntimeRuleBoundsV1.windowMs;
  const activities = canonicalBodyArray(
    row.activities,
    path,
    npAgentGuardianRuntimeRuleBoundsV1.maximumActivities,
    state,
  ).map((entry) => npParseAgentGuardianRuntimeActivityV1(entry, path, state));
  activities.sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
    const leftPhase = left.fact.kind === "provider-cost" ? costPhase(left.fact.phase) : 3,
      rightPhase = right.fact.kind === "provider-cost" ? costPhase(right.fact.phase) : 3;
    if (leftPhase !== rightPhase) return leftPhase - rightPhase;
    return left.observationId < right.observationId
      ? -1
      : left.observationId > right.observationId
        ? 1
        : 0;
  });
  const observed = new Map<string, string>(),
    unique: NpAgentGuardianRuntimeActivityV1[] = [];
  for (const activity of activities) {
    if (
      activity.siteId !== siteId ||
      activity.agentId !== agentId ||
      activity.occurredAt < startedAt ||
      Date.parse(activity.occurredAt) >= end
    )
      failCanonicalBody(
        "invalid-field",
        path,
        "cohort must have one actual site, Agent and fixed window",
      );
    const body = serializeAgentCanonicalJson(activity),
      prior = observed.get(activity.observationId);
    if (prior !== undefined && prior !== body)
      failCanonicalBody("duplicate", path, "conflicting source observation identity");
    if (prior === undefined) {
      observed.set(activity.observationId, body);
      unique.push(activity);
    }
  }
  const repeated: NpAgentGuardianRuntimeActivityV1[] = [],
    denied = new Map<string, NpAgentGuardianRuntimeActivityV1>(),
    actions = new Map<string, NpAgentGuardianRuntimeActivityV1>(),
    costs = new Map<string, CostActivity>();
  const actionSequences = new Map<string, string>(),
    callSequences = new Map<string, string>(),
    callBindings = new Map<string, string>(),
    runBindings = new Map<string, string>();
  for (const activity of unique) {
    const current = activity.fact;
    const currentBinding = binding(activity),
      priorBinding = runBindings.get(activity.runId);
    if (priorBinding !== undefined && priorBinding !== currentBinding)
      failCanonicalBody("duplicate", path, "conflicting immutable Run binding");
    runBindings.set(activity.runId, currentBinding);
    const calls =
      current.kind === "proposal-repeated"
        ? current.responses
        : current.kind === "scope-denied"
          ? [current.response]
          : current.kind === "provider-cost"
            ? [current]
            : [];
    for (const call of calls) {
      const sequence = `${activity.runId}:${call.sequence.toString()}`,
        priorId = callSequences.get(sequence),
        priorCallBinding = callBindings.get(call.providerCallId);
      const callBinding = `${currentBinding}:${call.sequence.toString()}`;
      if (
        (priorId !== undefined && priorId !== call.providerCallId) ||
        (priorCallBinding !== undefined && priorCallBinding !== callBinding)
      )
        failCanonicalBody("duplicate", path, "conflicting actual provider call identity");
      callSequences.set(sequence, call.providerCallId);
      callBindings.set(call.providerCallId, callBinding);
    }
    if (current.kind === "proposal-repeated") repeated.push(activity);
    if (current.kind === "scope-denied" || current.kind === "action-admitted") {
      const target = current.kind === "scope-denied" ? denied : actions;
      const id =
        current.kind === "scope-denied" ? current.response.providerCallId : current.actionId;
      const prior = target.get(id);
      if (
        prior &&
        (binding(prior) !== binding(activity) ||
          serializeAgentCanonicalJson(prior.fact) !== serializeAgentCanonicalJson(current))
      )
        failCanonicalBody("duplicate", path, "conflicting Runtime entity identity");
      if (!prior) target.set(id, activity);
      if (current.kind === "action-admitted") {
        const sequence = `${activity.runId}:${current.sequence.toString()}`,
          priorId = actionSequences.get(sequence);
        if (priorId !== undefined && priorId !== current.actionId)
          failCanonicalBody("duplicate", path, "conflicting actual Action sequence");
        actionSequences.set(sequence, current.actionId);
      }
    }
    if (current.kind === "provider-cost") {
      const prior = costs.get(current.providerCallId);
      if (prior) {
        if (
          binding(prior) !== binding(activity) ||
          prior.fact.reservationId !== current.reservationId ||
          prior.fact.sequence !== current.sequence ||
          prior.fact.requestDigest !== current.requestDigest ||
          costPhase(prior.fact.phase) > costPhase(current.phase) ||
          (costPhase(prior.fact.phase) === costPhase(current.phase) &&
            serializeAgentCanonicalJson(prior.fact) !== serializeAgentCanonicalJson(current))
        )
          failCanonicalBody("duplicate", path, "conflicting or regressed provider accounting");
        if (costPhase(prior.fact.phase) === 2) continue;
      }
      costs.set(current.providerCallId, { ...activity, fact: current });
    }
  }
  const result: NpAgentGuardianRuntimeRuleMatchV1[] = [];
  function match(
    detectorId: NpAgentGuardianRuntimeDetectorIdV1,
    cohort: NpAgentGuardianRuntimeActivityV1[],
    observedCount: number,
    accountingSummary: NpAgentGuardianRuntimeAccountingSummaryV1 | null,
  ): void {
    const endedAt = cohort.reduce(
      (last, entry) => (entry.occurredAt > last ? entry.occurredAt : last),
      startedAt,
    );
    result.push({
      detectorId,
      detectorVersion: 1,
      window: { startedAt, endedAt },
      basis: bases[detectorId],
      observedCount,
      countBasis: "at-least",
      assessment: "review-only",
      accounting: accountingSummary,
      observationIds: cohort.map((entry) => entry.observationId),
    });
  }
  if (repeated.length > 0) match("guardian.repeated-proposals", repeated.slice(0, 1), 2, null);
  if (denied.size >= 5) match("guardian.denied-scopes", [...denied.values()].slice(0, 5), 5, null);
  const accountingSummary: NpAgentGuardianRuntimeAccountingSummaryV1 = {
    reportedCallCount: 0,
    reportedCostMicros: 0,
    estimatedCallCount: 0,
    estimatedCostMicros: 0,
    knownCostMicros: 0,
    unknownCallCount: 0,
    unknownBudgetChargeMicros: 0,
    releasedCallCount: 0,
  };
  for (const entry of costs.values()) {
    const account = entry.fact.accounting;
    if (account.state === "unknown") {
      accountingSummary.unknownCallCount++;
      accountingSummary.unknownBudgetChargeMicros = sum(
        accountingSummary.unknownBudgetChargeMicros,
        account.budgetChargeCostMicros,
        path,
      );
    } else if (account.state === "released") accountingSummary.releasedCallCount++;
    else {
      accountingSummary.knownCostMicros = sum(
        accountingSummary.knownCostMicros,
        account.costMicros,
        path,
      );
      if (account.costSource === "provider") {
        accountingSummary.reportedCallCount++;
        accountingSummary.reportedCostMicros = sum(
          accountingSummary.reportedCostMicros,
          account.costMicros,
          path,
        );
      } else {
        accountingSummary.estimatedCallCount++;
        accountingSummary.estimatedCostMicros = sum(
          accountingSummary.estimatedCostMicros,
          account.costMicros,
          path,
        );
      }
    }
  }
  if (
    accountingSummary.knownCostMicros >= npAgentGuardianRuntimeRuleBoundsV1.knownSettledCostMicros
  )
    match("guardian.spend-velocity", [...costs.values()], costs.size, accountingSummary);
  if (actions.size >= 5)
    match("guardian.action-velocity", [...actions.values()].slice(0, 5), 5, null);
  return result;
}
