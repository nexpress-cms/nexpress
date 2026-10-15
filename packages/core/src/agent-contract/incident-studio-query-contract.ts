import {
  npRequireAgentIncidentListInputV1,
  type NpAgentIncidentListInputV1,
} from "./incident-contract.js";
import {
  canonicalBodyRecord,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodyEnum,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  canonicalRuntimeText,
} from "./canonical-runtime-primitives.js";

/** Staff Studio search only; the original Gateway list contract and hashes remain unchanged. */
export interface NpAgentIncidentStudioListQueryV1 extends NpAgentIncidentListInputV1 {
  source?: string;
  assignedAgentId?: string;
  containment?: "active" | "inactive";
  observedAfter?: string;
  observedBefore?: string;
  query?: string;
  includeSummaries?: boolean;
}
export function npRequireAgentIncidentStudioListQueryV1(
  value: unknown,
): NpAgentIncidentStudioListQueryV1 {
  const base = ["statuses", "categories", "severities", "updatedAfter", "limit", "cursor"];
  const extra = [
    "source",
    "assignedAgentId",
    "containment",
    "observedAfter",
    "observedBefore",
    "query",
    "includeSummaries",
  ];
  const path = "incident.studio.query";
  const raw = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 16384),
    path,
    [...base, ...extra],
    base,
    { seen: new WeakSet() },
  );
  const result: NpAgentIncidentStudioListQueryV1 = npRequireAgentIncidentListInputV1(
    Object.fromEntries(base.map((key) => [key, raw[key]])),
  );
  if (raw.source !== undefined) {
    const source = canonicalRuntimeText(raw.source, path, 128, { requireTrimmed: true });
    if (!/^[A-Za-z][A-Za-z0-9._:-]*$/u.test(source))
      failCanonicalBody("invalid-field", path, "Invalid source filter");
    result.source = source;
  }
  if (raw.assignedAgentId !== undefined)
    result.assignedAgentId = canonicalBodyUuid(raw.assignedAgentId, path);
  if (raw.containment !== undefined)
    result.containment = canonicalBodyEnum(
      raw.containment,
      path,
      new Set(["active", "inactive"] as const),
    );
  if (raw.observedAfter !== undefined)
    result.observedAfter = canonicalBodyUtc(raw.observedAfter, path);
  if (raw.observedBefore !== undefined)
    result.observedBefore = canonicalBodyUtc(raw.observedBefore, path);
  if (result.observedAfter && result.observedBefore && result.observedAfter > result.observedBefore)
    failCanonicalBody("invalid-field", path, "Invalid time range");
  if (raw.query !== undefined)
    result.query = canonicalRuntimeText(raw.query, path, 200, { requireTrimmed: true });
  if (raw.includeSummaries !== undefined) {
    if (typeof raw.includeSummaries !== "boolean")
      failCanonicalBody("invalid-field", path, "Invalid summary flag");
    result.includeSummaries = raw.includeSummaries;
  }
  return result;
}
