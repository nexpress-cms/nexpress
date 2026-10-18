import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

/** Existing Operator facts, never an authenticated Guardian detector or response grant. */
export interface NpAgentGuardianOperatorCoverageV1 {
  schemaVersion: "np.agent-guardian-operator-coverage.v1";
  basis: "operator-recorded-facts";
  state: "disabled" | "not-observed" | "observed" | "stale" | "unavailable";
  observedAt: string | null;
  jobs: { complete: boolean | null; paused: boolean | null; failuresComplete: boolean | null };
  health: { observed: boolean | null };
  events: { sampled: number | null; invalid: number | null; truncated: boolean };
}
export function npRequireAgentGuardianOperatorCoverageV1(
  input: unknown,
): NpAgentGuardianOperatorCoverageV1 {
  const p = "guardian.operatorCoverage";
  const fail = (): never =>
    failCanonicalBody("invalid-field", p, "Invalid recorded Operator coverage");
  const rec = (value: unknown, keys: string[]) =>
    canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
  const flag = (value: unknown) => (value === null || typeof value === "boolean" ? value : fail());
  const count = (value: unknown) =>
    value === null ? null : canonicalBodyInteger(value, p, 0, 100);
  const r = rec(cloneCanonicalRuntimeInput(input, p, 2048), [
    "schemaVersion",
    "basis",
    "state",
    "observedAt",
    "jobs",
    "health",
    "events",
  ]);
  const jobs = rec(r.jobs, ["complete", "paused", "failuresComplete"]);
  const health = rec(r.health, ["observed"]);
  const events = rec(r.events, ["sampled", "invalid", "truncated"]);
  const state = canonicalBodyEnum<NpAgentGuardianOperatorCoverageV1["state"]>(
    r.state,
    p,
    new Set(["disabled", "not-observed", "observed", "stale", "unavailable"]),
  );
  const result: NpAgentGuardianOperatorCoverageV1 = {
    schemaVersion: canonicalBodyEnum(
      r.schemaVersion,
      p,
      new Set(["np.agent-guardian-operator-coverage.v1"]),
    ),
    basis: canonicalBodyEnum(r.basis, p, new Set(["operator-recorded-facts"])),
    state,
    observedAt: r.observedAt === null ? null : canonicalBodyUtc(r.observedAt, p),
    jobs: {
      complete: flag(jobs.complete),
      paused: flag(jobs.paused),
      failuresComplete: flag(jobs.failuresComplete),
    },
    health: { observed: flag(health.observed) },
    events: {
      sampled: count(events.sampled),
      invalid: count(events.invalid),
      truncated: typeof events.truncated === "boolean" ? events.truncated : fail(),
    },
  };
  if (["observed", "stale"].includes(state)) {
    if (
      result.observedAt === null ||
      result.jobs.complete === null ||
      result.jobs.failuresComplete === null ||
      result.health.observed === null ||
      result.events.sampled === null ||
      result.events.invalid === null ||
      result.events.invalid > result.events.sampled
    )
      fail();
  } else if (
    result.observedAt !== null ||
    Object.values(result.jobs).some((v) => v !== null) ||
    result.health.observed !== null ||
    result.events.sampled !== null ||
    result.events.invalid !== null ||
    result.events.truncated
  )
    fail();
  return result;
}
