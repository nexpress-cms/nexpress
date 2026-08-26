import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  SIGNED_32_BIT_MAXIMUM,
  canonicalRuntimeDeduplicationKey,
  canonicalRuntimeStableCode,
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
  parseCanonicalCapabilityId,
  parseCanonicalIdentifier,
  parseCanonicalInteger,
  parseCanonicalJsonObject,
  parseCanonicalSha256,
  parseCanonicalSiteId,
  parseCanonicalUtc,
  parseCanonicalUuid,
  parseIncidentSeverity,
  parseNullableUuid,
  parseProviderDataClass,
  parseSortedUniqueEnumArray,
  parseSortedUniqueStrings,
} from "./canonical-runtime-primitives.js";
import {
  NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
  npAgentActorRestrictionScopes,
  npAgentAutonomyModes,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentIncidentCategories,
  type NpAgentActorRestrictionScope,
  type NpAgentAutonomyMode,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentCapabilityModeV1,
  type NpAgentContractResult,
  type NpAgentNotificationChannel,
  type NpAgentNotificationDeliveryCanonicalV1,
  type NpAgentNotificationSourceV1,
  type NpAgentPolicyCanonicalV1,
  type NpAgentPolicyRulesV1,
} from "./types.js";

const NOTIFICATION_PURPOSE = "np.agent-notification-delivery.v1" as const;
const POLICY_PURPOSE = "np.agent-policy.v1" as const;
const EXTERNAL_CHANNELS = new Set<string>(["email", "slack", "webhook", "siem"]);
const ALL_CHANNELS = new Set<string>(["admin", "email", "slack", "webhook", "siem"]);
const AUTONOMY_MODES = new Set<string>(npAgentAutonomyModes);
const INCIDENT_CATEGORIES = new Set<string>(npAgentIncidentCategories);
const ACTOR_RESTRICTION_SCOPES = new Set<string>(npAgentActorRestrictionScopes);
const RISK_PREVIEW_THRESHOLDS = new Set<string>(["reversible", "sensitive", "destructive"]);
const AUTOMATIC_RISKS = new Set<string>(["read", "reversible"]);
const GUARDIAN_SEVERITIES = new Set<string>(["high", "critical"]);
const DESTINATION_FINGERPRINT_PATTERN =
  /^cj1:hmac-sha256:([a-z][a-z0-9._-]{0,127}):[A-Za-z0-9_-]{43}$/u;
const ACCOUNT_SUBJECT_DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_POLICY_ENTRIES = 100;

export const npAgentNotificationDeliveryCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "notificationId",
  "channel",
  "source",
  "deduplicationKey",
  "payloadRedacted",
  "attempt",
  "adapter",
  "connection",
  "result",
  "observedAt",
] as const;

export const npAgentNotificationDeliveryCanonicalExcludedKeysV1 = [
  "deliveryResultDigest",
  "providerMessageId",
  "state",
  "attempts",
  "lastErrorCode",
  "nextAttemptAt",
  "sentAt",
  "createdAt",
  "updatedAt",
  "credential",
  "secretVersionId",
] as const;

export const npAgentNotificationDeliveryAdminIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "notificationId",
  "channel",
  "source",
  "deduplicationKey",
  "payloadRedacted",
  "attempt",
  "result",
  "observedAt",
] as const;

export const npAgentNotificationDeliveryExternalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "notificationId",
  "channel",
  "source",
  "deduplicationKey",
  "payloadRedacted",
  "attempt",
  "adapter",
  "connection",
  "result",
  "observedAt",
] as const;

export const npAgentPolicyCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "instructions",
  "rules",
] as const satisfies readonly (keyof NpAgentPolicyCanonicalV1)[];

export const npAgentPolicyCanonicalExcludedKeysV1 = [
  "policyHash",
  "contentHash",
  "siteId",
  "policyId",
  "agentId",
  "version",
  "status",
  "name",
  "createdBy",
  "createdAt",
  "activatedAt",
  "retiredAt",
] as const;

function parseNotificationSource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentNotificationSourceV1 {
  const keys = ["incidentId", "runId", "actionId", "transitionVersion"] as const;
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  const result: NpAgentNotificationSourceV1 = {
    incidentId: parseNullableUuid(record.incidentId, `${path}.incidentId`),
    runId: parseNullableUuid(record.runId, `${path}.runId`),
    actionId: parseNullableUuid(record.actionId, `${path}.actionId`),
    transitionVersion: parseCanonicalInteger(
      record.transitionVersion,
      `${path}.transitionVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
  };
  if (result.incidentId === null && result.runId === null && result.actionId === null) {
    failCanonicalBody("invalid-field", path, "requires at least one non-null source id");
  }
  return result;
}

function parseNotificationDeliveryCanonical(
  value: unknown,
): NpAgentNotificationDeliveryCanonicalV1 {
  const path = "agent.canonical.notificationDelivery";
  const cloned = cloneCanonicalRuntimeInput(
    value,
    path,
    npAgentCanonicalBodyMaxBytesV1[NOTIFICATION_PURPOSE],
  );
  if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) {
    failCanonicalBody("shape", path, "must be one notification delivery object");
  }
  const channel = Object.getOwnPropertyDescriptor(cloned, "channel")?.value;
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const keys =
    channel === "admin"
      ? npAgentNotificationDeliveryAdminIncludedKeysV1
      : npAgentNotificationDeliveryExternalIncludedKeysV1;
  const record = canonicalBodyRecord(cloned, path, keys, keys, state);
  if (record.schemaVersion !== NOTIFICATION_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${NOTIFICATION_PURPOSE}`);
  }
  const common = {
    schemaVersion: NOTIFICATION_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    notificationId: parseCanonicalUuid(record.notificationId, `${path}.notificationId`),
    source: parseNotificationSource(record.source, `${path}.source`, state),
    deduplicationKey: canonicalRuntimeDeduplicationKey(
      record.deduplicationKey,
      `${path}.deduplicationKey`,
    ),
    payloadRedacted: parseCanonicalJsonObject(record.payloadRedacted, `${path}.payloadRedacted`),
    observedAt: parseCanonicalUtc(record.observedAt, `${path}.observedAt`),
  };
  if (channel === "admin") {
    if (record.attempt !== 0) {
      failCanonicalBody("invalid-field", `${path}.attempt`, "must be 0 for Admin delivery");
    }
    const result = canonicalBodyRecord(
      record.result,
      `${path}.result`,
      ["state"],
      ["state"],
      state,
    );
    if (result.state !== "confirmed_local") {
      failCanonicalBody("invalid-field", `${path}.result.state`, "must be confirmed_local");
    }
    const body: NpAgentNotificationDeliveryCanonicalV1 = {
      ...common,
      channel: "admin",
      attempt: 0,
      result: { state: "confirmed_local" },
    };
    buildAgentCanonicalFoundationBytes(NOTIFICATION_PURPOSE, body);
    return body;
  }
  const externalChannel = canonicalBodyEnum<Exclude<NpAgentNotificationChannel, "admin">>(
    channel,
    `${path}.channel`,
    EXTERNAL_CHANNELS,
  );
  const adapterRecord = canonicalBodyRecord(
    record.adapter,
    `${path}.adapter`,
    ["id", "contractVersion", "fingerprint", "idempotency"],
    ["id", "contractVersion", "fingerprint", "idempotency"],
    state,
  );
  const connectionRecord = canonicalBodyRecord(
    record.connection,
    `${path}.connection`,
    [
      "id",
      "configSnapshotId",
      "configVersion",
      "configHash",
      "accountSubjectKeyId",
      "accountSubjectDigest",
      "destinationKeyId",
      "destinationFingerprint",
    ],
    [
      "id",
      "configSnapshotId",
      "configVersion",
      "configHash",
      "accountSubjectKeyId",
      "accountSubjectDigest",
      "destinationKeyId",
      "destinationFingerprint",
    ],
    state,
  );
  if (
    typeof connectionRecord.accountSubjectDigest !== "string" ||
    !ACCOUNT_SUBJECT_DIGEST_PATTERN.test(connectionRecord.accountSubjectDigest)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.connection.accountSubjectDigest`,
      "must be a 43-character base64url HMAC",
    );
  }
  const destinationKeyId = parseCanonicalIdentifier(
    connectionRecord.destinationKeyId,
    `${path}.connection.destinationKeyId`,
  );
  if (
    typeof connectionRecord.destinationFingerprint !== "string" ||
    !DESTINATION_FINGERPRINT_PATTERN.test(connectionRecord.destinationFingerprint) ||
    !connectionRecord.destinationFingerprint.startsWith(`cj1:hmac-sha256:${destinationKeyId}:`)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.connection.destinationFingerprint`,
      "must be a canonical destination HMAC under destinationKeyId",
    );
  }
  if (typeof record.result !== "object" || record.result === null || Array.isArray(record.result)) {
    failCanonicalBody("shape", `${path}.result`, "must be one exact external result branch");
  }
  const resultState = Object.getOwnPropertyDescriptor(record.result, "state")?.value;
  const resultKeys = resultState === "confirmed" ? ["state"] : ["state", "errorCode"];
  const resultRecord = canonicalBodyRecord(
    record.result,
    `${path}.result`,
    resultKeys,
    resultKeys,
    state,
  );
  if (resultState === "confirmed") {
    const body: NpAgentNotificationDeliveryCanonicalV1 = {
      ...common,
      channel: externalChannel,
      attempt: parseCanonicalInteger(record.attempt, `${path}.attempt`, 1, SIGNED_32_BIT_MAXIMUM),
      adapter: {
        id: parseCanonicalIdentifier(adapterRecord.id, `${path}.adapter.id`),
        contractVersion: parseCanonicalInteger(
          adapterRecord.contractVersion,
          `${path}.adapter.contractVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        ),
        fingerprint: parseCanonicalSha256(adapterRecord.fingerprint, `${path}.adapter.fingerprint`),
        idempotency: canonicalBodyEnum(
          adapterRecord.idempotency,
          `${path}.adapter.idempotency`,
          new Set(["enforced", "none"]),
        ),
      },
      connection: {
        id: parseCanonicalUuid(connectionRecord.id, `${path}.connection.id`),
        configSnapshotId: parseCanonicalUuid(
          connectionRecord.configSnapshotId,
          `${path}.connection.configSnapshotId`,
        ),
        configVersion: parseCanonicalInteger(
          connectionRecord.configVersion,
          `${path}.connection.configVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        ),
        configHash: parseCanonicalSha256(
          connectionRecord.configHash,
          `${path}.connection.configHash`,
        ),
        accountSubjectKeyId: parseCanonicalIdentifier(
          connectionRecord.accountSubjectKeyId,
          `${path}.connection.accountSubjectKeyId`,
        ),
        accountSubjectDigest: connectionRecord.accountSubjectDigest,
        destinationKeyId,
        destinationFingerprint: connectionRecord.destinationFingerprint,
      },
      result: { state: "confirmed" },
    };
    buildAgentCanonicalFoundationBytes(NOTIFICATION_PURPOSE, body);
    return body;
  }
  const failureState = canonicalBodyEnum<"retryable_not_sent" | "permanent_failure" | "ambiguous">(
    resultRecord.state,
    `${path}.result.state`,
    new Set(["retryable_not_sent", "permanent_failure", "ambiguous"]),
  );
  const body: NpAgentNotificationDeliveryCanonicalV1 = {
    ...common,
    channel: externalChannel,
    attempt: parseCanonicalInteger(record.attempt, `${path}.attempt`, 1, SIGNED_32_BIT_MAXIMUM),
    adapter: {
      id: parseCanonicalIdentifier(adapterRecord.id, `${path}.adapter.id`),
      contractVersion: parseCanonicalInteger(
        adapterRecord.contractVersion,
        `${path}.adapter.contractVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      fingerprint: parseCanonicalSha256(adapterRecord.fingerprint, `${path}.adapter.fingerprint`),
      idempotency: canonicalBodyEnum(
        adapterRecord.idempotency,
        `${path}.adapter.idempotency`,
        new Set(["enforced", "none"]),
      ),
    },
    connection: {
      id: parseCanonicalUuid(connectionRecord.id, `${path}.connection.id`),
      configSnapshotId: parseCanonicalUuid(
        connectionRecord.configSnapshotId,
        `${path}.connection.configSnapshotId`,
      ),
      configVersion: parseCanonicalInteger(
        connectionRecord.configVersion,
        `${path}.connection.configVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      configHash: parseCanonicalSha256(
        connectionRecord.configHash,
        `${path}.connection.configHash`,
      ),
      accountSubjectKeyId: parseCanonicalIdentifier(
        connectionRecord.accountSubjectKeyId,
        `${path}.connection.accountSubjectKeyId`,
      ),
      accountSubjectDigest: connectionRecord.accountSubjectDigest,
      destinationKeyId,
      destinationFingerprint: connectionRecord.destinationFingerprint,
    },
    result: {
      state: failureState,
      errorCode: canonicalRuntimeStableCode(resultRecord.errorCode, `${path}.result.errorCode`),
    },
  };
  buildAgentCanonicalFoundationBytes(NOTIFICATION_PURPOSE, body);
  return body;
}

function parseCapabilityModes(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentCapabilityModeV1[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_POLICY_ENTRIES, state);
  const result: NpAgentCapabilityModeV1[] = [];
  let previous: string | undefined;
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      ["capabilityId", "mode"],
      ["capabilityId", "mode"],
      state,
    );
    const capabilityId = parseCanonicalCapabilityId(
      record.capabilityId,
      `${entryPath}.capabilityId`,
    );
    if (previous !== undefined && capabilityId <= previous) {
      failCanonicalBody(
        capabilityId === previous ? "duplicate" : "order",
        `${entryPath}.capabilityId`,
        "must be sorted unique by capability id",
      );
    }
    result.push({
      capabilityId,
      mode: canonicalBodyEnum<NpAgentAutonomyMode>(
        record.mode,
        `${entryPath}.mode`,
        AUTONOMY_MODES,
      ),
    });
    previous = capabilityId;
  });
  return result;
}

function parseNullableStringSet(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): string[] | null {
  return value === null
    ? null
    : parseSortedUniqueStrings(value, path, MAXIMUM_POLICY_ENTRIES, 96, state, {
        identifier: true,
      });
}

function parsePolicyRules(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentPolicyRulesV1 {
  const keys = [
    "schemaVersion",
    "capabilityModes",
    "resources",
    "risk",
    "providerDataMaximum",
    "automation",
    "escalation",
    "retentionDays",
  ] as const;
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  if (record.schemaVersion !== "np.agent-policy-rules.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-policy-rules.v1");
  }
  const resources = canonicalBodyRecord(
    record.resources,
    `${path}.resources`,
    [
      "collections",
      "navigationLocations",
      "themeIds",
      "settingKeys",
      "incidentCategories",
      "actorRestrictionScopes",
    ],
    [
      "collections",
      "navigationLocations",
      "themeIds",
      "settingKeys",
      "incidentCategories",
      "actorRestrictionScopes",
    ],
    state,
  );
  const risk = canonicalBodyRecord(
    record.risk,
    `${path}.risk`,
    ["automaticActionMaximum", "requirePreviewAtOrAbove", "requireRecentAuthAtOrAbove"],
    ["automaticActionMaximum", "requirePreviewAtOrAbove", "requireRecentAuthAtOrAbove"],
    state,
  );
  const automation = canonicalBodyRecord(
    record.automation,
    `${path}.automation`,
    [
      "quietHoursUtc",
      "moderationAutoQuarantineMinBasisPoints",
      "moderationTargetsPerRun",
      "guardianLimitActorMinSeverity",
      "guardianRestrictionTtlSeconds",
    ],
    [
      "quietHoursUtc",
      "moderationAutoQuarantineMinBasisPoints",
      "moderationTargetsPerRun",
      "guardianLimitActorMinSeverity",
      "guardianRestrictionTtlSeconds",
    ],
    state,
  );
  const quietValues = canonicalBodyArray(
    automation.quietHoursUtc,
    `${path}.automation.quietHoursUtc`,
    8,
    state,
  );
  const quietHoursUtc: Array<{ startMinute: number; endMinute: number }> = [];
  let priorEnd = -1;
  quietValues.forEach((entry, index) => {
    const entryPath = `${path}.automation.quietHoursUtc[${index.toString()}]`;
    const window = canonicalBodyRecord(
      entry,
      entryPath,
      ["startMinute", "endMinute"],
      ["startMinute", "endMinute"],
      state,
    );
    const startMinute = parseCanonicalInteger(
      window.startMinute,
      `${entryPath}.startMinute`,
      0,
      1_439,
    );
    const endMinute = parseCanonicalInteger(window.endMinute, `${entryPath}.endMinute`, 1, 1_440);
    if (endMinute <= startMinute || startMinute < priorEnd) {
      failCanonicalBody("order", entryPath, "must be normalized, sorted, and non-overlapping");
    }
    quietHoursUtc.push({ startMinute, endMinute });
    priorEnd = endMinute;
  });
  const escalation = canonicalBodyRecord(
    record.escalation,
    `${path}.escalation`,
    ["minimumSeverity", "channels"],
    ["minimumSeverity", "channels"],
    state,
  );
  const retention = canonicalBodyRecord(
    record.retentionDays,
    `${path}.retentionDays`,
    ["events", "signals", "runDetails", "incidentsAndActions"],
    ["events", "signals", "runDetails", "incidentsAndActions"],
    state,
  );
  return {
    schemaVersion: "np.agent-policy-rules.v1",
    capabilityModes: parseCapabilityModes(record.capabilityModes, `${path}.capabilityModes`, state),
    resources: {
      collections: parseNullableStringSet(
        resources.collections,
        `${path}.resources.collections`,
        state,
      ),
      navigationLocations: parseNullableStringSet(
        resources.navigationLocations,
        `${path}.resources.navigationLocations`,
        state,
      ),
      themeIds: parseNullableStringSet(resources.themeIds, `${path}.resources.themeIds`, state),
      settingKeys: parseNullableStringSet(
        resources.settingKeys,
        `${path}.resources.settingKeys`,
        state,
      ),
      incidentCategories:
        resources.incidentCategories === null
          ? null
          : parseSortedUniqueEnumArray(
              resources.incidentCategories,
              `${path}.resources.incidentCategories`,
              INCIDENT_CATEGORIES,
              MAXIMUM_POLICY_ENTRIES,
              state,
            ),
      actorRestrictionScopes:
        resources.actorRestrictionScopes === null
          ? null
          : parseSortedUniqueEnumArray<NpAgentActorRestrictionScope>(
              resources.actorRestrictionScopes,
              `${path}.resources.actorRestrictionScopes`,
              ACTOR_RESTRICTION_SCOPES,
              MAXIMUM_POLICY_ENTRIES,
              state,
            ),
    },
    risk: {
      automaticActionMaximum: canonicalBodyEnum(
        risk.automaticActionMaximum,
        `${path}.risk.automaticActionMaximum`,
        AUTOMATIC_RISKS,
      ),
      requirePreviewAtOrAbove:
        risk.requirePreviewAtOrAbove === null
          ? null
          : canonicalBodyEnum(
              risk.requirePreviewAtOrAbove,
              `${path}.risk.requirePreviewAtOrAbove`,
              RISK_PREVIEW_THRESHOLDS,
            ),
      requireRecentAuthAtOrAbove:
        risk.requireRecentAuthAtOrAbove === null
          ? null
          : canonicalBodyEnum(
              risk.requireRecentAuthAtOrAbove,
              `${path}.risk.requireRecentAuthAtOrAbove`,
              RISK_PREVIEW_THRESHOLDS,
            ),
    },
    providerDataMaximum: parseProviderDataClass(
      record.providerDataMaximum,
      `${path}.providerDataMaximum`,
    ),
    automation: {
      quietHoursUtc,
      moderationAutoQuarantineMinBasisPoints:
        automation.moderationAutoQuarantineMinBasisPoints === null
          ? null
          : parseCanonicalInteger(
              automation.moderationAutoQuarantineMinBasisPoints,
              `${path}.automation.moderationAutoQuarantineMinBasisPoints`,
              0,
              10_000,
            ),
      moderationTargetsPerRun: parseCanonicalInteger(
        automation.moderationTargetsPerRun,
        `${path}.automation.moderationTargetsPerRun`,
        0,
        SIGNED_32_BIT_MAXIMUM,
      ),
      guardianLimitActorMinSeverity:
        automation.guardianLimitActorMinSeverity === null
          ? null
          : canonicalBodyEnum(
              automation.guardianLimitActorMinSeverity,
              `${path}.automation.guardianLimitActorMinSeverity`,
              GUARDIAN_SEVERITIES,
            ),
      guardianRestrictionTtlSeconds: parseCanonicalInteger(
        automation.guardianRestrictionTtlSeconds,
        `${path}.automation.guardianRestrictionTtlSeconds`,
        NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
        NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
      ),
    },
    escalation: {
      minimumSeverity: parseIncidentSeverity(
        escalation.minimumSeverity,
        `${path}.escalation.minimumSeverity`,
      ),
      channels: parseSortedUniqueEnumArray<NpAgentNotificationChannel>(
        escalation.channels,
        `${path}.escalation.channels`,
        ALL_CHANNELS,
        5,
        state,
      ),
    },
    retentionDays: {
      events: parseCanonicalInteger(retention.events, `${path}.retentionDays.events`, 1, 14),
      signals: parseCanonicalInteger(retention.signals, `${path}.retentionDays.signals`, 1, 90),
      runDetails: parseCanonicalInteger(
        retention.runDetails,
        `${path}.retentionDays.runDetails`,
        1,
        90,
      ),
      incidentsAndActions: parseCanonicalInteger(
        retention.incidentsAndActions,
        `${path}.retentionDays.incidentsAndActions`,
        1,
        365,
      ),
    },
  };
}

function parsePolicyCanonical(value: unknown): NpAgentPolicyCanonicalV1 {
  const path = "agent.canonical.policy";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[POLICY_PURPOSE]),
    path,
    npAgentPolicyCanonicalIncludedKeysV1,
    npAgentPolicyCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== POLICY_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${POLICY_PURPOSE}`);
  }
  const result: NpAgentPolicyCanonicalV1 = {
    schemaVersion: POLICY_PURPOSE,
    instructions: canonicalRuntimeText(record.instructions, `${path}.instructions`, 262_144, {
      allowEmpty: true,
    }),
    rules: parsePolicyRules(record.rules, `${path}.rules`, state),
  };
  buildAgentCanonicalFoundationBytes(POLICY_PURPOSE, result);
  return result;
}

export function npAnalyzeAgentNotificationDeliveryCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentNotificationDeliveryCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.notificationDelivery", () =>
    parseNotificationDeliveryCanonical(value),
  );
}

export function npRequireAgentNotificationDeliveryCanonical(
  value: unknown,
): NpAgentNotificationDeliveryCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentNotificationDeliveryCanonical(value),
    "Invalid Agent notification-delivery canonical body",
  );
}

export function npBuildAgentNotificationDeliveryCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-notification-delivery.v1",
  NpAgentNotificationDeliveryCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    NOTIFICATION_PURPOSE,
    npRequireAgentNotificationDeliveryCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-notification-delivery.v1",
    NpAgentNotificationDeliveryCanonicalV1
  >;
}

export async function npDigestAgentNotificationDeliveryCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentNotificationDeliveryCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export function npAnalyzeAgentPolicyCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentPolicyCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.policy", () => parsePolicyCanonical(value));
}

export function npRequireAgentPolicyCanonical(value: unknown): NpAgentPolicyCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentPolicyCanonical(value),
    "Invalid Agent policy canonical body",
  );
}

export function npBuildAgentPolicyCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-policy.v1", NpAgentPolicyCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    POLICY_PURPOSE,
    npRequireAgentPolicyCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<"np.agent-policy.v1", NpAgentPolicyCanonicalV1>;
}

export async function npDigestAgentPolicyCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(npBuildAgentPolicyCanonicalBytes(value).domainSeparatedUtf8);
}
