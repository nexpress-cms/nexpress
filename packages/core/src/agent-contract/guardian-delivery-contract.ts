import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
} from "./canonical-body-validation.js";

/** Bounded lower counts of source delivery states, never proof coverage or a loss estimate. */
export interface NpAgentGuardianReceiptCoverageV1 {
  pending: number;
  blocked: number;
  held: number;
  sampled: number;
  truncated: boolean;
}
export function npRequireAgentGuardianReceiptCoverageV1(
  value: unknown,
): NpAgentGuardianReceiptCoverageV1 {
  const p = "guardian.delivery.coverage",
    keys = ["pending", "blocked", "held", "sampled", "truncated"];
  const r = canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet() });
  if (typeof r.truncated !== "boolean")
    failCanonicalBody("invalid-field", p, "Invalid coverage bound");
  return {
    pending: canonicalBodyInteger(r.pending, p, 0, 25),
    blocked: canonicalBodyInteger(r.blocked, p, 0, 25),
    held: canonicalBodyInteger(r.held, p, 0, 25),
    sampled: canonicalBodyInteger(r.sampled, p, 0, 25),
    truncated: r.truncated,
  };
}
