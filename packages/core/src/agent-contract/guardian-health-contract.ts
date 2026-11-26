import {
  npRequireAgentGuardianReceiptCoverageV1,
  type NpAgentGuardianReceiptCoverageV1,
} from "./guardian-delivery-contract.js";
import {
  npRequireAgentGuardianContentCoverageV1,
  type NpAgentGuardianContentCoverageV1,
} from "./guardian-content-contract.js";
import {
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npAgentGuardianOperationsDetectorsV1,
  npAgentGuardianOperationsSourceIdsV1,
  type NpAgentGuardianOperationsDetectorIdV1,
  type NpAgentGuardianOperationsSourceIdV1,
} from "./guardian-operations-contract.js";

/** Aggregate diagnostics only. No site/Incident/Event identities or source/receipt bodies cross this wire. */
export interface NpAgentGuardianHealthV1 {
  schemaVersion: "np.agent-guardian-health.v1";
  generatedAt: string;
  windowStartedAt: string;
  state: "ok" | "warn" | "error" | "unavailable";
  coverage: "bounded-sample";
  detectors: {
    id: NpAgentGuardianOperationsDetectorIdV1;
    version: 1;
    source: NpAgentGuardianOperationsSourceIdV1;
  }[];
  controls: {
    sampledSites: number | null;
    unconfigured: number | null;
    enabled: number | null;
    disabled: number | null;
    invalid: number | null;
    truncated: boolean;
  };
  recentSignals: {
    sampled: number | null;
    invalid: number | null;
    unsupported: number | null;
    truncated: boolean;
  };
  currentCriticalIncidents: { observedCount: number | null; truncated: boolean };
  notificationFailures: { observedCount: number | null; truncated: boolean };
  contentReceipts?: NpAgentGuardianContentCoverageV1 | null;
  runtimeReceipts?: NpAgentGuardianReceiptCoverageV1 | null;
  proofs: {
    source: NpAgentGuardianOperationsSourceIdV1;
    registration: "unregistered" | "ready" | "disabled" | "unavailable";
    coverage: "unavailable" | "partial" | "verified";
    sampled: number | null;
    verified: number | null;
    unverifiable: number | null;
    truncated: boolean;
  }[];
}
const p = "guardian.health";
function fail(): never {
  return failCanonicalBody(
    "invalid-field",
    p,
    "must match exact aggregate Guardian health evidence",
  );
}
const rec = (v: unknown, keys: string[]) =>
  canonicalBodyRecord(v, p, keys, keys, { seen: new WeakSet() });
const en = <const T extends string>(v: unknown, values: readonly T[]) =>
  canonicalBodyEnum<T>(v, p, new Set(values));
const count = (v: unknown, max: number) => (v === null ? null : canonicalBodyInteger(v, p, 0, max));
function bool(v: unknown): boolean {
  if (typeof v !== "boolean") fail();
  return v;
}
const arr = (v: unknown, max: number) => canonicalBodyArray(v, p, max, { seen: new WeakSet() });
export function npRequireAgentGuardianHealthV1(value: unknown): NpAgentGuardianHealthV1 {
  const keys = [
    "schemaVersion",
    "generatedAt",
    "windowStartedAt",
    "state",
    "coverage",
    "detectors",
    "controls",
    "recentSignals",
    "currentCriticalIncidents",
    "notificationFailures",
    "proofs",
  ];
  const r = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, p, 16384),
    p,
    [...keys, "contentReceipts", "runtimeReceipts"],
    keys,
    { seen: new WeakSet() },
  );
  const contentReceipts =
    r.contentReceipts === undefined || r.contentReceipts === null
      ? r.contentReceipts
      : npRequireAgentGuardianContentCoverageV1(r.contentReceipts);
  const runtimeReceipts =
    r.runtimeReceipts === undefined || r.runtimeReceipts === null
      ? r.runtimeReceipts
      : npRequireAgentGuardianReceiptCoverageV1(r.runtimeReceipts);
  const generatedAt = canonicalBodyUtc(r.generatedAt, p),
    windowStartedAt = canonicalBodyUtc(r.windowStartedAt, p);
  if (Date.parse(generatedAt) - Date.parse(windowStartedAt) !== 86400000) fail();
  const detectors = arr(r.detectors, npAgentGuardianOperationsDetectorsV1.length).map((v) => {
    const d = rec(v, ["id", "version", "source"]);
    const parsed = {
      id: en(
        d.id,
        npAgentGuardianOperationsDetectorsV1.map((d) => d.id),
      ),
      version: canonicalBodyInteger(d.version, p, 1, 1) as 1,
      source: en(d.source, npAgentGuardianOperationsSourceIdsV1),
    };
    if (
      !npAgentGuardianOperationsDetectorsV1.some(
        (d) => d.id === parsed.id && d.source === parsed.source,
      )
    )
      fail();
    return parsed;
  });
  if (
    detectors.length !== npAgentGuardianOperationsDetectorsV1.length ||
    new Set(detectors.map((d) => d.id)).size !== npAgentGuardianOperationsDetectorsV1.length
  )
    fail();
  const c = rec(r.controls, [
    "sampledSites",
    "unconfigured",
    "enabled",
    "disabled",
    "invalid",
    "truncated",
  ]);
  const controls = {
    sampledSites: count(c.sampledSites, 25),
    unconfigured: count(c.unconfigured, 25),
    enabled: count(c.enabled, 25),
    disabled: count(c.disabled, 25),
    invalid: count(c.invalid, 25),
    truncated: bool(c.truncated),
  };
  if (
    controls.sampledSites === null
      ? controls.unconfigured !== null ||
        controls.enabled !== null ||
        controls.disabled !== null ||
        controls.invalid !== null
      : controls.unconfigured === null ||
        controls.enabled === null ||
        controls.disabled === null ||
        controls.invalid === null ||
        controls.unconfigured + controls.enabled + controls.disabled + controls.invalid !==
          controls.sampledSites
  )
    fail();
  const s = rec(r.recentSignals, ["sampled", "invalid", "unsupported", "truncated"]);
  const recentSignals = {
    sampled: count(s.sampled, 100),
    invalid: count(s.invalid, 100),
    unsupported: count(s.unsupported, 100),
    truncated: bool(s.truncated),
  };
  if (
    recentSignals.sampled === null
      ? recentSignals.invalid !== null || recentSignals.unsupported !== null
      : recentSignals.invalid === null ||
        recentSignals.unsupported === null ||
        recentSignals.invalid + recentSignals.unsupported > recentSignals.sampled
  )
    fail();
  const bounded = (v: unknown) => {
    const b = rec(v, ["observedCount", "truncated"]);
    return { observedCount: count(b.observedCount, 25), truncated: bool(b.truncated) };
  };
  const currentCriticalIncidents = bounded(r.currentCriticalIncidents),
    notificationFailures = bounded(r.notificationFailures);
  const proofs = arr(r.proofs, npAgentGuardianOperationsSourceIdsV1.length).map((v) => {
    const p = rec(v, [
      "source",
      "registration",
      "coverage",
      "sampled",
      "verified",
      "unverifiable",
      "truncated",
    ]);
    const parsed = {
      source: en(p.source, npAgentGuardianOperationsSourceIdsV1),
      registration: en(p.registration, ["unregistered", "ready", "disabled", "unavailable"]),
      coverage: en(p.coverage, ["unavailable", "partial", "verified"]),
      sampled: count(p.sampled, 25),
      verified: count(p.verified, 25),
      unverifiable: count(p.unverifiable, 25),
      truncated: bool(p.truncated),
    };
    if (
      parsed.coverage === "unavailable"
        ? parsed.sampled !== null || parsed.verified !== null || parsed.unverifiable !== null
        : parsed.registration !== "ready" ||
          parsed.sampled === null ||
          parsed.verified === null ||
          parsed.unverifiable === null ||
          parsed.verified + parsed.unverifiable !== parsed.sampled ||
          (parsed.coverage === "verified") !== (parsed.unverifiable === 0 && !parsed.truncated)
    )
      fail();
    return parsed;
  });
  if (
    proofs.length !== npAgentGuardianOperationsSourceIdsV1.length ||
    new Set(proofs.map((p) => p.source)).size !== npAgentGuardianOperationsSourceIdsV1.length
  )
    fail();
  const state = en(r.state, ["ok", "warn", "error", "unavailable"]);
  if (
    state === "unavailable"
      ? controls.sampledSites !== null ||
        recentSignals.sampled !== null ||
        currentCriticalIncidents.observedCount !== null ||
        notificationFailures.observedCount !== null
      : controls.sampledSites === null ||
        recentSignals.sampled === null ||
        currentCriticalIncidents.observedCount === null ||
        notificationFailures.observedCount === null
  )
    fail();
  if (
    state === "ok" &&
    (controls.invalid !== 0 ||
      controls.truncated ||
      recentSignals.invalid !== 0 ||
      recentSignals.unsupported !== 0 ||
      recentSignals.truncated ||
      currentCriticalIncidents.observedCount !== 0 ||
      currentCriticalIncidents.truncated ||
      notificationFailures.observedCount !== 0 ||
      notificationFailures.truncated ||
      (contentReceipts !== undefined &&
        (contentReceipts === null ||
          contentReceipts.blocked > 0 ||
          contentReceipts.held > 0 ||
          contentReceipts.truncated)) ||
      (runtimeReceipts !== undefined &&
        (runtimeReceipts === null ||
          runtimeReceipts.blocked > 0 ||
          runtimeReceipts.held > 0 ||
          runtimeReceipts.truncated)) ||
      proofs.some((p) => p.coverage !== "verified"))
  )
    fail();
  if (
    (controls.invalid ?? 0) + (recentSignals.invalid ?? 0) + (recentSignals.unsupported ?? 0) > 0 &&
    state !== "error"
  )
    fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-health.v1"]),
    generatedAt,
    windowStartedAt,
    state,
    coverage: en(r.coverage, ["bounded-sample"]),
    detectors,
    controls,
    recentSignals,
    currentCriticalIncidents,
    notificationFailures,
    proofs,
    ...(contentReceipts === undefined ? {} : { contentReceipts }),
    ...(runtimeReceipts === undefined ? {} : { runtimeReceipts }),
  };
}
