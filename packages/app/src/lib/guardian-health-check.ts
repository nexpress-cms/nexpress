import type { NpAgentGuardianHealthV1 } from "@nexpress/core/agent-contract";
import type { Check } from "./system-health-checks";

export function checkGuardianSignals(summary?: NpAgentGuardianHealthV1): Check {
  const known = (value: number | null | undefined) =>
    value === null || value === undefined ? "unknown" : String(value);
  return {
    id: "guardian.signals",
    label: "Guardian signals and source coverage",
    state: summary?.state === "ok" ? "ok" : summary?.state === "error" ? "error" : "warn",
    detail: summary
      ? `Bounded sample · detectors ${summary.detectors.length} · recent Signals ${known(summary.recentSignals.sampled)} (invalid ${known(summary.recentSignals.invalid)}) · current critical Incidents at least ${known(summary.currentCriticalIncidents.observedCount)} · notification failures at least ${known(summary.notificationFailures.observedCount)} · controls disabled ${known(summary.controls.disabled)}, invalid ${known(summary.controls.invalid)}. CMS delivery lower counts pending ${known(summary.contentReceipts?.pending)}, blocked ${known(summary.contentReceipts?.blocked)}, held ${known(summary.contentReceipts?.held)}, capped ${known(summary.contentReceipts?.sampled)}. Runtime delivery lower counts pending ${known(summary.runtimeReceipts?.pending)}, blocked ${known(summary.runtimeReceipts?.blocked)}, held ${known(summary.runtimeReceipts?.held)}, capped ${known(summary.runtimeReceipts?.sampled)}. Proof coverage: ${summary.proofs.map((proof) => `${proof.source} ${proof.registration}/${proof.coverage}`).join("; ")}.`
      : "Guardian evidence unavailable. Source registration, historical proof and capture state were not verified.",
    hint: "Unregistered or unavailable proof is not a healthy zero. Checking does not install sources, load keys or enable responses. Guardian complements application authentication, rate limiting and WAF/IDS/SIEM.",
  };
}
