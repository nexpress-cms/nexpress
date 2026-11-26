import {
  npParseAgentSecurityImpactV1 as impact,
  type NpAgentSecurityImpactV1,
} from "./guardian-security-impact-contract.js";
export {
  npParseAgentSecurityImpactV1,
  type NpAgentSecurityImpactV1,
} from "./guardian-security-impact-contract.js";
import { npUserRoles, type NpUserRole } from "../auth-contract/types.js";
import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npParseAgentSecurityCredentialChangePayloadV1,
  type NpAgentSecurityCredentialChangePayloadV1,
} from "./guardian-credential-contract.js";
import {
  npParseAgentSecurityPluginChangePayloadV1,
  type NpAgentSecurityPluginChangePayloadV1,
} from "./guardian-plugin-contract.js";

export type NpAgentSecurityAuthorityTransitionV1 =
  | {
      kind: "site-role";
      userId: string;
      previousRole: NpUserRole | null;
      currentRole: NpUserRole | null;
    }
  | {
      kind: "super-admin";
      userId: string;
      previous: boolean;
      current: boolean;
    };
export interface NpAgentSecurityPolicyStateV1 {
  version: number;
  rowVersion: number;
  contentHash: string;
  status: "draft" | "active" | "retired";
}
export interface NpAgentSecurityPolicyTransitionV1 {
  kind: "agent-policy";
  policyId: string;
  agentId: string | null;
  previous: NpAgentSecurityPolicyStateV1 | null;
  current: NpAgentSecurityPolicyStateV1;
}
interface SourceBinding {
  transitionId: string;
  sourceReceiptId: string;
  impact: NpAgentSecurityImpactV1;
}
/** Private canonical Event facts; never accept these as an HTTP mutation target. */
export type NpAgentSecurityAuthorityChangePayloadV1 = SourceBinding & {
  kind: "security.authority.changed";
  transition: NpAgentSecurityAuthorityTransitionV1;
};
export type NpAgentSecurityPolicyChangePayloadV1 = SourceBinding & {
  kind: "agent.policy.changed";
  transition: NpAgentSecurityPolicyTransitionV1;
};
export type NpAgentSecurityTransitionPayloadV1 =
  | NpAgentSecurityAuthorityChangePayloadV1
  | NpAgentSecurityPolicyChangePayloadV1
  | NpAgentSecurityCredentialChangePayloadV1
  | NpAgentSecurityPluginChangePayloadV1;

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") failCanonicalBody("invalid-field", path, "must be boolean");
  return value;
}
function role(value: unknown, path: string): NpUserRole | null {
  return value === null ? null : canonicalBodyEnum(value, path, new Set(npUserRoles));
}
export function npParseAgentSecurityAuthorityTransitionV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityAuthorityTransitionV1 {
  const kind =
    typeof value === "object" && value !== null
      ? (Object.getOwnPropertyDescriptor(value, "kind")?.value as unknown)
      : undefined;
  const keys =
    kind === "site-role"
      ? ["kind", "userId", "previousRole", "currentRole"]
      : ["kind", "userId", "previous", "current"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const userId = canonicalBodyUuid(row.userId, path);
  if (kind === "site-role") {
    const previousRole = role(row.previousRole, path);
    const currentRole = role(row.currentRole, path);
    if (previousRole === currentRole)
      failCanonicalBody("invalid-field", path, "must be an actual authority change");
    return { kind, userId, previousRole, currentRole };
  }
  if (kind !== "super-admin") failCanonicalBody("invalid-field", path, "unknown authority kind");
  const previous = boolean(row.previous, path),
    current = boolean(row.current, path);
  if (previous === current)
    failCanonicalBody("invalid-field", path, "must be an actual authority change");
  return { kind, userId, previous, current };
}
function policyState(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityPolicyStateV1 {
  const keys = ["version", "rowVersion", "contentHash", "status"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    version: canonicalBodyInteger(row.version, path, 1, 2_147_483_647),
    rowVersion: canonicalBodyInteger(row.rowVersion, path, 1, 2_147_483_647),
    contentHash: canonicalBodySha256Digest(row.contentHash, path),
    status: canonicalBodyEnum(row.status, path, new Set(["draft", "active", "retired"] as const)),
  };
}
export function npParseAgentSecurityPolicyTransitionV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityPolicyTransitionV1 {
  const keys = ["kind", "policyId", "agentId", "previous", "current"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const previous = row.previous === null ? null : policyState(row.previous, path, state);
  const current = policyState(row.current, path, state);
  if (previous && current.rowVersion <= previous.rowVersion)
    failCanonicalBody("invalid-field", path, "must advance the policy row version");
  return {
    kind: canonicalBodyEnum(row.kind, path, new Set(["agent-policy"] as const)),
    policyId: canonicalBodyUuid(row.policyId, path),
    agentId: row.agentId === null ? null : canonicalBodyUuid(row.agentId, path),
    previous,
    current,
  };
}
/** Called by the canonical Event parser with its existing traversal budget. */
export function npParseAgentSecurityTransitionPayloadV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityTransitionPayloadV1 {
  const incomingKind =
    typeof value === "object" && value !== null
      ? (Object.getOwnPropertyDescriptor(value, "kind")?.value as unknown)
      : undefined;
  if (incomingKind === "security.credential.changed")
    return npParseAgentSecurityCredentialChangePayloadV1(value, path, state);
  if (incomingKind === "security.plugin.changed")
    return npParseAgentSecurityPluginChangePayloadV1(value, path, state);
  const keys = ["kind", "transitionId", "sourceReceiptId", "impact", "transition"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const kind = canonicalBodyEnum<"security.authority.changed" | "agent.policy.changed">(
    row.kind,
    path,
    new Set(["security.authority.changed", "agent.policy.changed"] as const),
  );
  const common = {
    transitionId: canonicalBodyUuid(row.transitionId, path),
    sourceReceiptId: canonicalBodyUuid(row.sourceReceiptId, path),
    impact: impact(row.impact, path, state),
  };
  if (kind === "security.authority.changed") {
    const transition = npParseAgentSecurityAuthorityTransitionV1(row.transition, path, state);
    if ((transition.kind === "super-admin") !== (common.impact.scope === "deployment"))
      failCanonicalBody("invalid-field", path, "authority impact does not match its owner");
    return { kind, ...common, transition };
  }
  if (common.impact.scope !== "site")
    failCanonicalBody("invalid-field", path, "Agent policies are site scoped");
  return {
    kind,
    ...common,
    transition: npParseAgentSecurityPolicyTransitionV1(row.transition, path, state),
  };
}
export function npRequireAgentSecurityTransitionPayloadV1(
  value: unknown,
): NpAgentSecurityTransitionPayloadV1 {
  return npParseAgentSecurityTransitionPayloadV1(
    cloneCanonicalRuntimeInput(value, "guardian.security.transition", 16_384),
    "guardian.security.transition",
    { seen: new WeakSet<object>() },
  );
}

export const npAgentGuardianSecurityDetectorIdsV1 = [
  "guardian.authority-escalated",
  "guardian.policy-activated",
  "guardian.credential-changed",
  "guardian.plugin-changed",
] as const;
/** Safe immutable proof summary; no user ids, role names, policy input or execution target. */
export interface NpAgentGuardianSecurityEvidenceV1 {
  schemaVersion: "np.agent-guardian-security-evidence.v1";
  signalId: string;
  detectorId: (typeof npAgentGuardianSecurityDetectorIdsV1)[number];
  detectorVersion: 1;
  basis: "committed-transition";
  targetKind:
    | "site-role"
    | "super-admin"
    | "agent-policy"
    | "password-replaced"
    | "gateway-principal"
    | "gateway-token"
    | "connection-credential"
    | "plugin-activation"
    | "plugin-config";
  observedAt: string;
  sourceDigest: string;
  impact: NpAgentSecurityImpactV1;
}
export function npRequireAgentGuardianSecurityEvidenceV1(
  value: unknown,
): NpAgentGuardianSecurityEvidenceV1 {
  const path = "guardian.security.evidence";
  const keys = [
    "schemaVersion",
    "signalId",
    "detectorId",
    "detectorVersion",
    "basis",
    "targetKind",
    "observedAt",
    "sourceDigest",
    "impact",
  ];
  const state = { seen: new WeakSet<object>() };
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 8192),
    path,
    keys,
    keys,
    state,
  );
  const detectorId = canonicalBodyEnum<NpAgentGuardianSecurityEvidenceV1["detectorId"]>(
    row.detectorId,
    path,
    new Set(npAgentGuardianSecurityDetectorIdsV1),
  );
  const targetKind = canonicalBodyEnum<NpAgentGuardianSecurityEvidenceV1["targetKind"]>(
    row.targetKind,
    path,
    new Set([
      "site-role",
      "super-admin",
      "agent-policy",
      "password-replaced",
      "gateway-principal",
      "gateway-token",
      "connection-credential",
      "plugin-activation",
      "plugin-config",
    ] as const),
  );
  const checkedImpact = impact(row.impact, path, state);
  const expectedDetector =
    targetKind === "agent-policy"
      ? "guardian.policy-activated"
      : targetKind === "site-role" || targetKind === "super-admin"
        ? "guardian.authority-escalated"
        : targetKind === "plugin-activation" || targetKind === "plugin-config"
          ? "guardian.plugin-changed"
          : "guardian.credential-changed";
  if (
    detectorId !== expectedDetector ||
    (targetKind === "super-admin" || targetKind === "password-replaced") !==
      (checkedImpact.scope === "deployment")
  )
    failCanonicalBody("invalid-field", path, "inconsistent security evidence");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-security-evidence.v1"] as const),
    ),
    signalId: canonicalBodyUuid(row.signalId, path),
    detectorId,
    detectorVersion: canonicalBodyInteger(row.detectorVersion, path, 1, 1) as 1,
    basis: canonicalBodyEnum(row.basis, path, new Set(["committed-transition"] as const)),
    targetKind,
    observedAt: canonicalBodyUtc(row.observedAt, path),
    sourceDigest: canonicalBodySha256Digest(row.sourceDigest, path),
    impact: checkedImpact,
  };
}
