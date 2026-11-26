import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { npPluginIdMaxLength, npPluginIdPattern } from "../plugins/id-contract.js";
import {
  npParseAgentGuardianSourceStateCommitmentV1,
  type NpAgentGuardianSourceStateCommitmentV1,
} from "./guardian-credential-contract.js";
import {
  npParseAgentSecurityImpactV1,
  type NpAgentSecurityImpactV1,
} from "./guardian-security-impact-contract.js";

/** Before/current source inputs are prepared from locked persisted state.
 * No config body, config field names, secrets or unkeyed config hashes occur here. */
export interface NpAgentSecurityPluginActivationSourceStateV1 {
  enabled: boolean;
  commitment: NpAgentGuardianSourceStateCommitmentV1;
}
export interface NpAgentSecurityPluginConfigSourceStateV1 {
  schemaVersion: number;
  commitment: NpAgentGuardianSourceStateCommitmentV1;
}
export type NpAgentSecurityPluginTransitionV1 =
  | {
      kind: "plugin-activation";
      pluginId: string;
      previous: NpAgentSecurityPluginActivationSourceStateV1;
      current: NpAgentSecurityPluginActivationSourceStateV1;
    }
  | {
      kind: "plugin-config";
      pluginId: string;
      previous: NpAgentSecurityPluginConfigSourceStateV1 | null;
      current: NpAgentSecurityPluginConfigSourceStateV1;
    };
export interface NpAgentSecurityPluginChangePayloadV1 {
  kind: "security.plugin.changed";
  transitionId: string;
  sourceReceiptId: string;
  impact: NpAgentSecurityImpactV1 & { scope: "site" };
  transition: NpAgentSecurityPluginTransitionV1;
}
function pluginId(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npPluginIdMaxLength ||
    !new RegExp(npPluginIdPattern, "u").test(value)
  )
    failCanonicalBody("invalid-field", path, "must be a registered-shape npm plugin id");
  return value;
}
function activation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityPluginActivationSourceStateV1 {
  const keys = ["enabled", "commitment"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  if (typeof r.enabled !== "boolean")
    failCanonicalBody("invalid-field", path, "effective plugin activation must be boolean");
  return {
    enabled: r.enabled,
    commitment: npParseAgentGuardianSourceStateCommitmentV1(
      r.commitment,
      `${path}.commitment`,
      state,
    ),
  };
}
function config(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityPluginConfigSourceStateV1 {
  const keys = ["schemaVersion", "commitment"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    schemaVersion: canonicalBodyInteger(r.schemaVersion, path, 1, 2147483647),
    commitment: npParseAgentGuardianSourceStateCommitmentV1(
      r.commitment,
      `${path}.commitment`,
      state,
    ),
  };
}
export function npParseAgentSecurityPluginTransitionV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityPluginTransitionV1 {
  const keys = ["kind", "pluginId", "previous", "current"],
    r = canonicalBodyRecord(value, path, keys, keys, state),
    id = pluginId(r.pluginId, path);
  if (r.kind === "plugin-activation") {
    const previous = activation(r.previous, `${path}.previous`, state),
      current = activation(r.current, `${path}.current`, state);
    if (
      previous.enabled === current.enabled ||
      previous.commitment.keyId !== current.commitment.keyId ||
      previous.commitment.mac === current.commitment.mac
    )
      failCanonicalBody(
        "invalid-field",
        path,
        "must be an actual effective activation change bound under one source key",
      );
    return { kind: r.kind, pluginId: id, previous, current };
  }
  if (r.kind === "plugin-config") {
    const previous = r.previous === null ? null : config(r.previous, `${path}.previous`, state),
      current = config(r.current, `${path}.current`, state);
    if (
      previous &&
      (previous.commitment.keyId !== current.commitment.keyId ||
        previous.commitment.mac === current.commitment.mac)
    )
      failCanonicalBody(
        "invalid-field",
        path,
        "must be an actual persisted config change bound under one source key",
      );
    return { kind: r.kind, pluginId: id, previous, current };
  }
  return failCanonicalBody("invalid-field", path, "unknown plugin transition kind");
}
export function npRequireAgentSecurityPluginTransitionV1(
  value: unknown,
): NpAgentSecurityPluginTransitionV1 {
  return npParseAgentSecurityPluginTransitionV1(
    cloneCanonicalRuntimeInput(value, "guardian.plugin.transition", 4096),
    "guardian.plugin.transition",
    { seen: new WeakSet<object>() },
  );
}
/** Private source payload only; reload, discovery and code installation are not
 * committed site activation/config transitions and are intentionally excluded. */
export function npParseAgentSecurityPluginChangePayloadV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSecurityPluginChangePayloadV1 {
  const keys = ["kind", "transitionId", "sourceReceiptId", "impact", "transition"],
    r = canonicalBodyRecord(value, path, keys, keys, state);
  if (r.kind !== "security.plugin.changed")
    failCanonicalBody("invalid-field", path, "unknown plugin payload kind");
  const impact = npParseAgentSecurityImpactV1(r.impact, `${path}.impact`, state);
  if (impact.scope !== "site")
    failCanonicalBody("invalid-field", path, "persisted plugin activation/config is site scoped");
  return {
    kind: r.kind,
    transitionId: canonicalBodyUuid(r.transitionId, path),
    sourceReceiptId: canonicalBodyUuid(r.sourceReceiptId, path),
    impact: { ...impact, scope: "site" },
    transition: npParseAgentSecurityPluginTransitionV1(r.transition, `${path}.transition`, state),
  };
}
export function npRequireAgentSecurityPluginChangePayloadV1(
  value: unknown,
): NpAgentSecurityPluginChangePayloadV1 {
  return npParseAgentSecurityPluginChangePayloadV1(
    cloneCanonicalRuntimeInput(value, "guardian.plugin.payload", 8192),
    "guardian.plugin.payload",
    { seen: new WeakSet<object>() },
  );
}
