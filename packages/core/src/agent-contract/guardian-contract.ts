import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

/** Fixed source families, never a request path, query, address or account name. */
export const npAgentGuardianRouteFamiliesV1 = [
  "mcp",
  "agent-oauth",
  "staff-auth",
  "member-auth",
  "media-upload",
  "import",
  "collections",
  "cms",
  "community",
  "plugin-public",
  "plugins",
  "users",
  "search",
  "reports",
  "newsletter",
  "community-events",
  "views",
  "jobs-retry-all",
  "jobs-enqueue",
  "job-retry",
  "admin",
  "internal",
  "security-ingress",
] as const;
export type NpAgentGuardianRouteFamilyV1 = (typeof npAgentGuardianRouteFamiliesV1)[number];
export const NP_AGENT_GUARDIAN_WINDOW_MS_V1 = 600_000;
export const NP_AGENT_GUARDIAN_THRESHOLD_V1 = 5;
/** A site can retain at most this many request observations in one UTC window. */
export const NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1 = 100;
export const npAgentGuardianDetectorIdsV1 = [
  "guardian.login-failures",
  "guardian.rate-limits",
] as const;

/** Staff projection of verified immutable observations. Counts are lower bounds:
 * sampling stops at the threshold and may also stop at the site/time budget. */
export interface NpAgentGuardianEvidenceV1 {
  schemaVersion: "np.agent-guardian-evidence.v1";
  signalId: string;
  detectorId: (typeof npAgentGuardianDetectorIdsV1)[number];
  audience: "staff" | "member" | null;
  routeFamily: NpAgentGuardianRouteFamilyV1 | null;
  window: { startedAt: string; endedAt: string };
  observedCount: number;
  threshold: number;
  countBasis: "at-least";
}
export function npRequireAgentGuardianEvidenceV1(value: unknown): NpAgentGuardianEvidenceV1 {
  const path = "guardian.evidence";
  const state = { seen: new WeakSet<object>() };
  const keys = [
    "schemaVersion",
    "signalId",
    "detectorId",
    "audience",
    "routeFamily",
    "window",
    "observedCount",
    "threshold",
    "countBasis",
  ];
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 8192),
    path,
    keys,
    keys,
    state,
  );
  const window = canonicalBodyRecord(
    row.window,
    path,
    ["startedAt", "endedAt"],
    ["startedAt", "endedAt"],
    state,
  );
  const startedAt = canonicalBodyUtc(window.startedAt, path);
  const endedAt = canonicalBodyUtc(window.endedAt, path);
  const start = Date.parse(startedAt);
  if (
    start % NP_AGENT_GUARDIAN_WINDOW_MS_V1 !== 0 ||
    Date.parse(endedAt) < start ||
    Date.parse(endedAt) >= start + NP_AGENT_GUARDIAN_WINDOW_MS_V1
  )
    failCanonicalBody("invalid-field", path, "Invalid Guardian observation window");
  const detectorId = canonicalBodyEnum<NpAgentGuardianEvidenceV1["detectorId"]>(
    row.detectorId,
    path,
    new Set(npAgentGuardianDetectorIdsV1),
  );
  const audience =
    row.audience === null
      ? null
      : canonicalBodyEnum<"staff" | "member">(
          row.audience,
          path,
          new Set(["staff", "member"] as const),
        );
  const routeFamily =
    row.routeFamily === null
      ? null
      : canonicalBodyEnum<NpAgentGuardianRouteFamilyV1>(
          row.routeFamily,
          path,
          new Set(npAgentGuardianRouteFamiliesV1),
        );
  if (
    detectorId === "guardian.login-failures"
      ? audience === null || routeFamily !== null
      : audience !== null || routeFamily === null
  )
    failCanonicalBody("invalid-field", path, "Invalid Guardian source binding");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-evidence.v1"] as const),
    ),
    signalId: canonicalBodyUuid(row.signalId, path),
    detectorId,
    audience,
    routeFamily,
    window: { startedAt, endedAt },
    observedCount: canonicalBodyInteger(
      row.observedCount,
      path,
      NP_AGENT_GUARDIAN_THRESHOLD_V1,
      NP_AGENT_GUARDIAN_THRESHOLD_V1,
    ),
    threshold: canonicalBodyInteger(
      row.threshold,
      path,
      NP_AGENT_GUARDIAN_THRESHOLD_V1,
      NP_AGENT_GUARDIAN_THRESHOLD_V1,
    ),
    countBasis: canonicalBodyEnum(row.countBasis, path, new Set(["at-least"] as const)),
  };
}
