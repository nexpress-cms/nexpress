import {
  analyzeCanonicalBody,
  canonicalBodyEnum,
  canonicalBodyArray,
  canonicalBodyRecord,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  npRequireAgentCapabilityModesV1,
  npRequireAgentPolicyRulesV1,
} from "./canonical-notification-policy.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npAgentAutonomyModes,
  npAgentIncidentSeverityRank,
  npAgentProviderDataClassRank,
  type NpAgentAutonomyMode,
  type NpAgentCapabilityModeV1,
  type NpAgentContractResult,
  type NpAgentPolicyRulesV1,
  type NpAgentProviderDataClass,
} from "./types.js";

const MODES = new Set<string>(npAgentAutonomyModes);
const MODE_MEET = {
  observe: { observe: "observe", advise: "observe", guarded: "observe", approved: "observe" },
  advise: { observe: "observe", advise: "advise", guarded: "advise", approved: "advise" },
  guarded: { observe: "observe", advise: "advise", guarded: "guarded", approved: "advise" },
  approved: { observe: "observe", advise: "advise", guarded: "advise", approved: "approved" },
} as const satisfies Record<NpAgentAutonomyMode, Record<NpAgentAutonomyMode, NpAgentAutonomyMode>>;
const RISK_RANK = { read: 0, reversible: 1, sensitive: 2, destructive: 3 } as const;

export const npAgentPolicyLayerMaximumV1 = 16;

export function npMeetAgentAutonomyModesV1(
  left: NpAgentAutonomyMode,
  right: NpAgentAutonomyMode,
): NpAgentAutonomyMode {
  return MODE_MEET[canonicalBodyEnum<NpAgentAutonomyMode>(left, "agent.autonomy.left", MODES)][
    canonicalBodyEnum<NpAgentAutonomyMode>(right, "agent.autonomy.right", MODES)
  ];
}

export type NpAgentRuntimePermissionV1 =
  "read" | "propose" | "execute-automatic" | "request-approval" | "execute-approved";

/** Permission sets are not an ordinal autonomy ladder. Descriptor floors remain authoritative. */
export function npAgentAutonomyAllowsV1(
  mode: NpAgentAutonomyMode,
  permission: NpAgentRuntimePermissionV1,
): boolean {
  const parsed = canonicalBodyEnum<NpAgentAutonomyMode>(mode, "agent.autonomy", MODES);
  switch (permission) {
    case "read":
      return true;
    case "propose":
      return parsed !== "observe";
    case "execute-automatic":
      return parsed === "guarded";
    case "request-approval":
    case "execute-approved":
      return parsed === "approved";
    default:
      return false;
  }
}

/** Derived evaluation only: unlike one stored rule, a union may have more than eight deny periods. */
export type NpAgentResolvedPolicyV1 = Omit<NpAgentPolicyRulesV1, "schemaVersion">;

export interface NpAgentPolicyResolutionInputV1 {
  autonomy: NpAgentAutonomyMode;
  capabilityModes: readonly NpAgentCapabilityModeV1[];
  layers: readonly NpAgentPolicyRulesV1[];
  providerDataMaximum?: NpAgentProviderDataClass;
}

function intersect<T extends string>(
  left: readonly T[] | null,
  right: readonly T[] | null,
): T[] | null {
  if (left === null) return right === null ? null : [...right];
  if (right === null) return [...left];
  const allowed = new Set(right);
  return left.filter((value) => allowed.has(value));
}

function threshold<T extends "reversible" | "sensitive" | "destructive">(
  left: T | null,
  right: T | null,
): T | null {
  if (left === null) return right;
  if (right === null) return left;
  return RISK_RANK[left] < RISK_RANK[right] ? left : right;
}

function unionQuietHours(
  layers: readonly NpAgentPolicyRulesV1[],
): NpAgentPolicyRulesV1["automation"]["quietHoursUtc"] {
  const windows = layers.flatMap((layer) =>
    layer.automation.quietHoursUtc.map((window) => ({ ...window })),
  );
  windows.sort(
    (left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute,
  );
  const result: typeof windows = [];
  for (const window of windows) {
    const previous = result.at(-1);
    if (previous && window.startMinute <= previous.endMinute) {
      previous.endMinute = Math.max(previous.endMinute, window.endMinute);
    } else result.push(window);
  }
  return result;
}

export function npAnalyzeAgentPolicyResolutionV1(
  input: unknown,
): NpAgentContractResult<NpAgentResolvedPolicyV1> {
  return analyzeCanonicalBody("agent.policyResolution", () => {
    const path = "agent.policyResolution";
    const state = { seen: new WeakSet<object>() };
    const row = canonicalBodyRecord(
      input,
      path,
      ["autonomy", "capabilityModes", "layers", "providerDataMaximum"],
      ["autonomy", "capabilityModes", "layers"],
      state,
    );
    const autonomy = canonicalBodyEnum<NpAgentAutonomyMode>(row.autonomy, "agent.autonomy", MODES);
    const modes = npRequireAgentCapabilityModesV1(row.capabilityModes);
    const layerValues = canonicalBodyArray(
      row.layers,
      `${path}.layers`,
      npAgentPolicyLayerMaximumV1,
      state,
    );
    if (layerValues.length < 1)
      failCanonicalBody("limit", `${path}.layers`, "requires 1..16 policy layers");
    const layers = layerValues.map((layer) => npRequireAgentPolicyRulesV1(layer));
    const first = layers[0];
    let capabilityModes = modes.map((entry) => ({
      capabilityId: entry.capabilityId,
      mode: npMeetAgentAutonomyModesV1(autonomy, entry.mode),
    }));
    let resources = { ...first.resources };
    let risk = { ...first.risk };
    let providerDataMaximum = first.providerDataMaximum;
    let automation = { ...first.automation };
    let escalation = { ...first.escalation };
    let retentionDays = { ...first.retentionDays };
    for (const layer of layers) {
      const layerModes = new Map(
        layer.capabilityModes.map((entry) => [entry.capabilityId, entry.mode]),
      );
      capabilityModes = capabilityModes.flatMap((entry) => {
        const mode = layerModes.get(entry.capabilityId);
        return mode === undefined
          ? []
          : [
              {
                capabilityId: entry.capabilityId,
                mode: npMeetAgentAutonomyModesV1(entry.mode, mode),
              },
            ];
      });
      resources = {
        collections: intersect(resources.collections, layer.resources.collections),
        navigationLocations: intersect(
          resources.navigationLocations,
          layer.resources.navigationLocations,
        ),
        themeIds: intersect(resources.themeIds, layer.resources.themeIds),
        settingKeys: intersect(resources.settingKeys, layer.resources.settingKeys),
        incidentCategories: intersect(
          resources.incidentCategories,
          layer.resources.incidentCategories,
        ),
        actorRestrictionScopes: intersect(
          resources.actorRestrictionScopes,
          layer.resources.actorRestrictionScopes,
        ),
      };
      risk = {
        automaticActionMaximum:
          risk.automaticActionMaximum === "read" || layer.risk.automaticActionMaximum === "read"
            ? "read"
            : "reversible",
        requirePreviewAtOrAbove: threshold(
          risk.requirePreviewAtOrAbove,
          layer.risk.requirePreviewAtOrAbove,
        ),
        requireRecentAuthAtOrAbove: threshold(
          risk.requireRecentAuthAtOrAbove,
          layer.risk.requireRecentAuthAtOrAbove,
        ),
      };
      if (
        npAgentProviderDataClassRank[layer.providerDataMaximum] <
        npAgentProviderDataClassRank[providerDataMaximum]
      ) {
        providerDataMaximum = layer.providerDataMaximum;
      }
      const confidence = automation.moderationAutoQuarantineMinBasisPoints;
      const otherConfidence = layer.automation.moderationAutoQuarantineMinBasisPoints;
      const severity = automation.guardianLimitActorMinSeverity;
      const otherSeverity = layer.automation.guardianLimitActorMinSeverity;
      automation = {
        quietHoursUtc: [],
        moderationAutoQuarantineMinBasisPoints:
          confidence === null || otherConfidence === null
            ? null
            : Math.max(confidence, otherConfidence),
        moderationTargetsPerRun: Math.min(
          automation.moderationTargetsPerRun,
          layer.automation.moderationTargetsPerRun,
        ),
        guardianLimitActorMinSeverity:
          severity === null || otherSeverity === null
            ? null
            : npAgentIncidentSeverityRank[severity] >= npAgentIncidentSeverityRank[otherSeverity]
              ? severity
              : otherSeverity,
        guardianRestrictionTtlSeconds: Math.min(
          automation.guardianRestrictionTtlSeconds,
          layer.automation.guardianRestrictionTtlSeconds,
        ),
      };
      escalation = {
        minimumSeverity:
          npAgentIncidentSeverityRank[escalation.minimumSeverity] >=
          npAgentIncidentSeverityRank[layer.escalation.minimumSeverity]
            ? escalation.minimumSeverity
            : layer.escalation.minimumSeverity,
        channels: intersect(escalation.channels, layer.escalation.channels) ?? [],
      };
      retentionDays = {
        events: Math.min(retentionDays.events, layer.retentionDays.events),
        signals: Math.min(retentionDays.signals, layer.retentionDays.signals),
        runDetails: Math.min(retentionDays.runDetails, layer.retentionDays.runDetails),
        incidentsAndActions: Math.min(
          retentionDays.incidentsAndActions,
          layer.retentionDays.incidentsAndActions,
        ),
      };
    }
    if (row.providerDataMaximum !== undefined) {
      const ceiling = canonicalBodyEnum<NpAgentProviderDataClass>(
        row.providerDataMaximum,
        "agent.policyResolution.providerDataMaximum",
        new Set(Object.keys(npAgentProviderDataClassRank)),
      );
      if (npAgentProviderDataClassRank[ceiling] < npAgentProviderDataClassRank[providerDataMaximum])
        providerDataMaximum = ceiling;
    }
    automation.quietHoursUtc = unionQuietHours(layers);
    return {
      capabilityModes,
      resources,
      risk,
      providerDataMaximum,
      automation,
      escalation,
      retentionDays,
    };
  });
}

export function npResolveAgentPolicyV1(
  input: NpAgentPolicyResolutionInputV1,
): NpAgentResolvedPolicyV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentPolicyResolutionV1(input),
    "Invalid Agent policy resolution",
  );
}

export function npIsAgentPolicyQuietTimeV1(policy: NpAgentResolvedPolicyV1, at: string): boolean {
  const date = new Date(canonicalBodyUtc(at, "agent.policyResolution.at"));
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return policy.automation.quietHoursUtc.some(
    (window) => window.startMinute <= minute && minute < window.endMinute,
  );
}
