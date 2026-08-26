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
import {
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
} from "./canonical-foundation.js";
import {
  DOMAIN_IDENTIFIER_MAXIMUM,
  SIGNED_32_BIT_MAXIMUM,
  canonicalRuntimeDeduplicationKey,
  canonicalRuntimeLowercaseSha256,
  canonicalRuntimeStableCode,
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
  parseActorBucket,
  parseAgentActorProjection,
  parseAgentSubject,
  parseCanonicalAscii,
  parseCanonicalCapabilityId,
  parseCanonicalIdentifier,
  parseCanonicalInteger,
  parseCanonicalSiteId,
  parseCanonicalUtc,
  parseCanonicalUuid,
  parseIncidentCategory,
  parseIncidentSeverity,
  parseNullableAscii,
  parseNullableStableCode,
  parseNullableUuid,
} from "./canonical-runtime-primitives.js";
import {
  npAgentActionStates,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentEventKinds,
  npAgentRunStates,
  type NpAgentActionState,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentEventCanonicalV1,
  type NpAgentEventCausationV1,
  type NpAgentEventKind,
  type NpAgentEventPayload,
  type NpAgentEvidenceRef,
  type NpAgentRunState,
  type NpAgentSignalEvidenceCanonicalV1,
} from "./types.js";

const EVENT_PURPOSE = "np.agent-event.v1" as const;
const SIGNAL_PURPOSE = "np.agent-signal-evidence.v1" as const;
const EVENT_KINDS = new Set<string>(npAgentEventKinds);
const EVENT_SOURCE_KINDS = new Set<string>([
  "auth",
  "api",
  "community",
  "content",
  "jobs",
  "ops",
  "storage",
  "plugin",
  "integration",
  "agent",
]);
const EVENT_PRIVACY = new Set<string>(["public", "internal", "sensitive"]);
const RUN_STATES = new Set<string>(npAgentRunStates);
const ACTION_STATES = new Set<string>(npAgentActionStates);
const MAXIMUM_EVIDENCE = 100;

export const npAgentEventCanonicalIncludedKeysV1 = [
  "version",
  "siteId",
  "kind",
  "occurredAt",
  "source",
  "subject",
  "actor",
  "causation",
  "correlationId",
  "deduplicationKey",
  "privacy",
  "payload",
] as const satisfies readonly (keyof NpAgentEventCanonicalV1)[];

export const npAgentEventCanonicalExcludedKeysV1 = [
  "id",
  "eventHash",
  "recordedAt",
  "dispatchedAt",
  "expiresAt",
  "dispatchState",
  "retentionState",
] as const;

export const npAgentSignalEvidenceCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "detectorId",
  "detectorVersion",
  "category",
  "window",
  "subject",
  "evidence",
] as const satisfies readonly (keyof NpAgentSignalEvidenceCanonicalV1)[];

export const npAgentSignalEvidenceCanonicalExcludedKeysV1 = [
  "evidenceDigest",
  "signalId",
  "severity",
  "confidenceBasis",
  "scoreBasisPoints",
  "fingerprint",
  "status",
  "incidentId",
  "createdAt",
  "updatedAt",
  "expiresAt",
] as const;

function parseEventSource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentEventCanonicalV1["source"] {
  const record = canonicalBodyRecord(
    value,
    path,
    ["kind", "component"],
    ["kind", "component"],
    state,
  );
  return {
    kind: canonicalBodyEnum(record.kind, `${path}.kind`, EVENT_SOURCE_KINDS),
    component: parseCanonicalIdentifier(
      record.component,
      `${path}.component`,
      DOMAIN_IDENTIFIER_MAXIMUM,
    ),
  };
}

function parseCausation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentEventCausationV1 {
  const keys = ["rootRunId", "sourceRunId", "sourceActionId", "depth"] as const;
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    rootRunId: parseCanonicalUuid(record.rootRunId, `${path}.rootRunId`),
    sourceRunId: parseCanonicalUuid(record.sourceRunId, `${path}.sourceRunId`),
    sourceActionId: parseCanonicalUuid(record.sourceActionId, `${path}.sourceActionId`),
    depth: parseCanonicalInteger(record.depth, `${path}.depth`, 0, 4),
  };
}

function payloadRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
  state: CanonicalBodyInspectionState,
): Record<string, unknown> {
  return canonicalBodyRecord(value, path, keys, keys, state);
}

function parseEventPayload(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentEventPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact event payload branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (typeof kind !== "string" || !EVENT_KINDS.has(kind)) {
    failCanonicalBody("invalid-field", `${path}.kind`, "is not a supported event kind");
  }
  if (kind === "auth.login.failed" || kind === "auth.login.succeeded") {
    const record = payloadRecord(
      value,
      path,
      [
        "kind",
        "audience",
        "outcome",
        "reasonCode",
        "sessionFamilyId",
        "ipBucket",
        "userAgentFamily",
      ],
      state,
    );
    const expectedOutcome = kind === "auth.login.failed" ? "failed" : "succeeded";
    if (record.outcome !== expectedOutcome) {
      failCanonicalBody("invalid-field", `${path}.outcome`, `must be ${expectedOutcome}`);
    }
    const sessionFamilyId =
      kind === "auth.login.failed"
        ? parseNullableUuid(record.sessionFamilyId, `${path}.sessionFamilyId`)
        : parseCanonicalUuid(record.sessionFamilyId, `${path}.sessionFamilyId`);
    return {
      kind,
      audience: canonicalBodyEnum(
        record.audience,
        `${path}.audience`,
        new Set(["staff", "member"]),
      ),
      outcome: expectedOutcome,
      reasonCode: canonicalRuntimeStableCode(record.reasonCode, `${path}.reasonCode`),
      sessionFamilyId,
      ipBucket: {
        ...parseActorBucket(record.ipBucket, `${path}.ipBucket`, state, "network-address"),
        purpose: "network-address",
      },
      userAgentFamily: parseNullableAscii(record.userAgentFamily, `${path}.userAgentFamily`, 96),
    } as NpAgentEventPayload;
  }
  if (kind === "auth.session.revoked") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "audience", "sessionFamilyId", "reasonCode"],
      state,
    );
    return {
      kind,
      audience: canonicalBodyEnum(
        record.audience,
        `${path}.audience`,
        new Set(["staff", "member"]),
      ),
      sessionFamilyId: parseCanonicalUuid(record.sessionFamilyId, `${path}.sessionFamilyId`),
      reasonCode: canonicalRuntimeStableCode(record.reasonCode, `${path}.reasonCode`),
    };
  }
  if (kind === "authz.denied") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "capabilityCode", "resourceKind", "reasonCode"],
      state,
    );
    return {
      kind,
      capabilityCode: parseCanonicalAscii(record.capabilityCode, `${path}.capabilityCode`, 96),
      resourceKind: parseCanonicalIdentifier(record.resourceKind, `${path}.resourceKind`, 96),
      reasonCode: canonicalRuntimeStableCode(record.reasonCode, `${path}.reasonCode`),
    };
  }
  if (kind === "authz.role.changed") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "actorKind", "actorId", "previousRole", "currentRole"],
      state,
    );
    return {
      kind,
      actorKind: canonicalBodyEnum(
        record.actorKind,
        `${path}.actorKind`,
        new Set(["staff", "member"]),
      ),
      actorId: parseCanonicalUuid(record.actorId, `${path}.actorId`),
      previousRole: parseCanonicalAscii(record.previousRole, `${path}.previousRole`, 96),
      currentRole: parseCanonicalAscii(record.currentRole, `${path}.currentRole`, 96),
    };
  }
  if (kind.startsWith("community.content.")) {
    const record = payloadRecord(
      value,
      path,
      ["kind", "targetKind", "targetId", "collection", "authorMemberId", "verdictCode", "status"],
      state,
    );
    return {
      kind: kind as
        "community.content.created" | "community.content.reported" | "community.content.moderated",
      targetKind: canonicalBodyEnum(
        record.targetKind,
        `${path}.targetKind`,
        new Set(["comment", "document"]),
      ),
      targetId: parseCanonicalAscii(record.targetId, `${path}.targetId`, 128),
      collection: parseCanonicalIdentifier(record.collection, `${path}.collection`, 96),
      authorMemberId: parseNullableUuid(record.authorMemberId, `${path}.authorMemberId`),
      verdictCode: parseNullableStableCode(record.verdictCode, `${path}.verdictCode`),
      status: canonicalBodyEnum(
        record.status,
        `${path}.status`,
        new Set(["visible", "quarantined", "hidden", "deleted"]),
      ),
    };
  }
  if (kind === "content.document.changed" || kind === "content.document.published") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "collection", "documentId", "transition", "revisionId"],
      state,
    );
    return {
      kind,
      collection: parseCanonicalIdentifier(record.collection, `${path}.collection`, 96),
      documentId: parseCanonicalAscii(record.documentId, `${path}.documentId`, 128),
      transition: canonicalRuntimeStableCode(record.transition, `${path}.transition`),
      revisionId: parseCanonicalAscii(record.revisionId, `${path}.revisionId`, 128),
    };
  }
  if (kind === "jobs.handler.failed") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "handlerName", "jobId", "reasonCode"],
      state,
    );
    return {
      kind,
      handlerName: parseCanonicalIdentifier(record.handlerName, `${path}.handlerName`, 96),
      jobId: parseCanonicalAscii(record.jobId, `${path}.jobId`, 128),
      reasonCode: canonicalRuntimeStableCode(record.reasonCode, `${path}.reasonCode`),
    };
  }
  if (kind === "jobs.worker.stale") {
    const record = payloadRecord(value, path, ["kind", "workerId", "lastHeartbeatAt"], state);
    return {
      kind,
      workerId: parseCanonicalAscii(record.workerId, `${path}.workerId`, 128),
      lastHeartbeatAt: parseCanonicalUtc(record.lastHeartbeatAt, `${path}.lastHeartbeatAt`),
    };
  }
  if (kind === "jobs.backlog.threshold") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "handlerName", "countBucket", "threshold"],
      state,
    );
    return {
      kind,
      handlerName: parseCanonicalIdentifier(record.handlerName, `${path}.handlerName`, 96),
      countBucket: parseCanonicalInteger(
        record.countBucket,
        `${path}.countBucket`,
        0,
        SIGNED_32_BIT_MAXIMUM,
      ),
      threshold: parseCanonicalInteger(
        record.threshold,
        `${path}.threshold`,
        0,
        SIGNED_32_BIT_MAXIMUM,
      ),
    };
  }
  if (kind === "ops.check.changed") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "checkId", "previousStatus", "currentStatus"],
      state,
    );
    const statuses = new Set(["pass", "warn", "fail", "unknown"]);
    return {
      kind,
      checkId: parseCanonicalIdentifier(record.checkId, `${path}.checkId`, 96),
      previousStatus: canonicalBodyEnum(record.previousStatus, `${path}.previousStatus`, statuses),
      currentStatus: canonicalBodyEnum(record.currentStatus, `${path}.currentStatus`, statuses),
    };
  }
  if (kind === "ops.backup.failed" || kind === "ops.backup.stale") {
    const record = payloadRecord(value, path, ["kind", "artifactId", "reasonCode"], state);
    return {
      kind,
      artifactId: parseNullableAscii(record.artifactId, `${path}.artifactId`, 128),
      reasonCode: canonicalRuntimeStableCode(record.reasonCode, `${path}.reasonCode`),
    };
  }
  if (kind === "security.edge.signal" || kind === "security.error.signal") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "adapterId", "externalSignalId", "category", "severity", "count"],
      state,
    );
    return {
      kind,
      adapterId: parseCanonicalIdentifier(record.adapterId, `${path}.adapterId`, 96),
      externalSignalId: parseCanonicalAscii(
        record.externalSignalId,
        `${path}.externalSignalId`,
        128,
      ),
      category: parseIncidentCategory(record.category, `${path}.category`),
      severity: parseIncidentSeverity(record.severity, `${path}.severity`),
      count: parseCanonicalInteger(record.count, `${path}.count`, 0, SIGNED_32_BIT_MAXIMUM),
    };
  }
  if (kind === "agent.run.changed") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "agentId", "runId", "previousState", "currentState", "reasonCode"],
      state,
    );
    return {
      kind,
      agentId: parseNullableUuid(record.agentId, `${path}.agentId`),
      runId: parseCanonicalUuid(record.runId, `${path}.runId`),
      previousState:
        record.previousState === null
          ? null
          : canonicalBodyEnum<NpAgentRunState>(
              record.previousState,
              `${path}.previousState`,
              RUN_STATES,
            ),
      currentState: canonicalBodyEnum<NpAgentRunState>(
        record.currentState,
        `${path}.currentState`,
        RUN_STATES,
      ),
      reasonCode: parseNullableStableCode(record.reasonCode, `${path}.reasonCode`),
    };
  }
  if (kind === "agent.action.changed") {
    const record = payloadRecord(
      value,
      path,
      ["kind", "runId", "actionId", "previousState", "currentState", "reasonCode"],
      state,
    );
    return {
      kind,
      runId: parseNullableUuid(record.runId, `${path}.runId`),
      actionId: parseCanonicalUuid(record.actionId, `${path}.actionId`),
      previousState:
        record.previousState === null
          ? null
          : canonicalBodyEnum<NpAgentActionState>(
              record.previousState,
              `${path}.previousState`,
              ACTION_STATES,
            ),
      currentState: canonicalBodyEnum<NpAgentActionState>(
        record.currentState,
        `${path}.currentState`,
        ACTION_STATES,
      ),
      reasonCode: parseNullableStableCode(record.reasonCode, `${path}.reasonCode`),
    };
  }
  const record = payloadRecord(
    value,
    path,
    ["kind", "agentId", "runId", "capabilityId", "reasonCode"],
    state,
  );
  return {
    kind: "agent.policy.blocked",
    agentId: parseNullableUuid(record.agentId, `${path}.agentId`),
    runId: parseNullableUuid(record.runId, `${path}.runId`),
    capabilityId:
      record.capabilityId === null
        ? null
        : parseCanonicalCapabilityId(record.capabilityId, `${path}.capabilityId`),
    reasonCode: canonicalRuntimeStableCode(record.reasonCode, `${path}.reasonCode`),
  };
}

function parseEventCanonical(value: unknown): NpAgentEventCanonicalV1 {
  const path = "agent.canonical.event";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[EVENT_PURPOSE], {
      maximumDepth: 8,
      maximumNodes: 128,
      maximumArrayItems: 64,
    }),
    path,
    npAgentEventCanonicalIncludedKeysV1,
    npAgentEventCanonicalIncludedKeysV1,
    state,
  );
  if (record.version !== EVENT_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.version`, `must be ${EVENT_PURPOSE}`);
  }
  const kind = canonicalBodyEnum<NpAgentEventKind>(record.kind, `${path}.kind`, EVENT_KINDS);
  const payload = parseEventPayload(record.payload, `${path}.payload`, state);
  if (payload.kind !== kind) {
    failCanonicalBody("invalid-field", `${path}.payload.kind`, "must equal the envelope kind");
  }
  const result: NpAgentEventCanonicalV1 = {
    version: EVENT_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    kind,
    occurredAt: parseCanonicalUtc(record.occurredAt, `${path}.occurredAt`),
    source: parseEventSource(record.source, `${path}.source`, state),
    subject:
      record.subject === null ? null : parseAgentSubject(record.subject, `${path}.subject`, state),
    actor:
      record.actor === null
        ? null
        : parseAgentActorProjection(record.actor, `${path}.actor`, state),
    causation:
      record.causation === null
        ? null
        : parseCausation(record.causation, `${path}.causation`, state),
    correlationId: parseNullableAscii(record.correlationId, `${path}.correlationId`, 128),
    deduplicationKey:
      record.deduplicationKey === null
        ? null
        : canonicalRuntimeDeduplicationKey(record.deduplicationKey, `${path}.deduplicationKey`),
    privacy: canonicalBodyEnum(record.privacy, `${path}.privacy`, EVENT_PRIVACY),
    payload,
  };
  buildAgentCanonicalFoundationBytes(EVENT_PURPOSE, result);
  return result;
}

function parseEvidenceRef(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentEvidenceRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact evidence reference branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  const common = ["kind", "observedAt", "digest", "excerpt"] as const;
  const branch =
    kind === "event"
      ? [...common, "eventId", "eventKind"]
      : kind === "revision"
        ? [...common, "collection", "documentId", "revisionId"]
        : kind === "job"
          ? [...common, "jobName", "jobId"]
          : kind === "ops-check"
            ? [...common, "checkId"]
            : kind === "external-signal"
              ? [...common, "adapterId", "externalSignalId"]
              : null;
  if (branch === null) {
    failCanonicalBody("invalid-field", `${path}.kind`, "is not a supported evidence kind");
  }
  const record = canonicalBodyRecord(value, path, branch, branch, state);
  const base = {
    observedAt: parseCanonicalUtc(record.observedAt, `${path}.observedAt`),
    digest: canonicalRuntimeLowercaseSha256(record.digest, `${path}.digest`),
    excerpt:
      record.excerpt === null
        ? null
        : canonicalRuntimeText(record.excerpt, `${path}.excerpt`, 1_000, { allowEmpty: true }),
  };
  if (kind === "event") {
    return {
      kind,
      ...base,
      eventId: parseCanonicalUuid(record.eventId, `${path}.eventId`),
      eventKind: canonicalBodyEnum(record.eventKind, `${path}.eventKind`, EVENT_KINDS),
    };
  }
  if (kind === "revision") {
    return {
      kind,
      ...base,
      collection: parseCanonicalIdentifier(record.collection, `${path}.collection`, 96),
      documentId: parseCanonicalAscii(record.documentId, `${path}.documentId`, 128),
      revisionId: parseCanonicalAscii(record.revisionId, `${path}.revisionId`, 128),
    };
  }
  if (kind === "job") {
    return {
      kind,
      ...base,
      jobName: parseCanonicalIdentifier(record.jobName, `${path}.jobName`, 96),
      jobId: parseCanonicalAscii(record.jobId, `${path}.jobId`, 128),
    };
  }
  if (kind === "ops-check") {
    return {
      kind,
      ...base,
      checkId: parseCanonicalIdentifier(record.checkId, `${path}.checkId`, 96),
    };
  }
  return {
    kind: "external-signal",
    ...base,
    adapterId: parseCanonicalIdentifier(record.adapterId, `${path}.adapterId`, 96),
    externalSignalId: parseCanonicalAscii(record.externalSignalId, `${path}.externalSignalId`, 128),
  };
}

function evidenceSourceId(value: NpAgentEvidenceRef): string {
  switch (value.kind) {
    case "event":
      return value.eventId;
    case "revision":
      return `${value.collection}\0${value.documentId}\0${value.revisionId}`;
    case "job":
      return `${value.jobName}\0${value.jobId}`;
    case "ops-check":
      return value.checkId;
    case "external-signal":
      return `${value.adapterId}\0${value.externalSignalId}`;
  }
}

function compareEvidence(left: NpAgentEvidenceRef, right: NpAgentEvidenceRef): number {
  const leftTuple = [left.observedAt, left.kind, evidenceSourceId(left), left.digest];
  const rightTuple = [right.observedAt, right.kind, evidenceSourceId(right), right.digest];
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] === rightTuple[index]) continue;
    return (leftTuple[index] ?? "") < (rightTuple[index] ?? "") ? -1 : 1;
  }
  return 0;
}

function parseSignalEvidenceCanonical(value: unknown): NpAgentSignalEvidenceCanonicalV1 {
  const path = "agent.canonical.signalEvidence";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[SIGNAL_PURPOSE]),
    path,
    npAgentSignalEvidenceCanonicalIncludedKeysV1,
    npAgentSignalEvidenceCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== SIGNAL_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${SIGNAL_PURPOSE}`);
  }
  const windowRecord = canonicalBodyRecord(
    record.window,
    `${path}.window`,
    ["startedAt", "endedAt"],
    ["startedAt", "endedAt"],
    state,
  );
  const window = {
    startedAt: parseCanonicalUtc(windowRecord.startedAt, `${path}.window.startedAt`),
    endedAt: parseCanonicalUtc(windowRecord.endedAt, `${path}.window.endedAt`),
  };
  if (window.endedAt < window.startedAt) {
    failCanonicalBody("invalid-field", `${path}.window.endedAt`, "must not predate startedAt");
  }
  const evidenceValues = canonicalBodyArray(
    record.evidence,
    `${path}.evidence`,
    MAXIMUM_EVIDENCE,
    state,
  );
  if (evidenceValues.length === 0) {
    failCanonicalBody("invalid-field", `${path}.evidence`, "must contain at least one reference");
  }
  const evidence: NpAgentEvidenceRef[] = [];
  let previous: NpAgentEvidenceRef | undefined;
  const exactBodies = new Set<string>();
  evidenceValues.forEach((entry, index) => {
    const entryPath = `${path}.evidence[${index.toString()}]`;
    const current = parseEvidenceRef(entry, entryPath, state);
    if (current.observedAt < window.startedAt || current.observedAt > window.endedAt) {
      failCanonicalBody(
        "invalid-field",
        `${entryPath}.observedAt`,
        "must fall within the signal window",
      );
    }
    if (previous !== undefined) {
      const order = compareEvidence(current, previous);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          entryPath,
          "must be sorted by the canonical evidence tuple",
        );
      }
    }
    const exactBody = serializeAgentCanonicalJson(current);
    if (exactBodies.has(exactBody)) {
      failCanonicalBody("duplicate", entryPath, "must be unique by complete reference body");
    }
    exactBodies.add(exactBody);
    evidence.push(current);
    previous = current;
  });
  const result: NpAgentSignalEvidenceCanonicalV1 = {
    schemaVersion: SIGNAL_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    detectorId: parseCanonicalIdentifier(record.detectorId, `${path}.detectorId`, 96),
    detectorVersion: parseCanonicalInteger(
      record.detectorVersion,
      `${path}.detectorVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    category: parseIncidentCategory(record.category, `${path}.category`),
    window,
    subject:
      record.subject === null ? null : parseAgentSubject(record.subject, `${path}.subject`, state),
    evidence,
  };
  buildAgentCanonicalFoundationBytes(SIGNAL_PURPOSE, result);
  return result;
}

export function npAnalyzeAgentEventCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentEventCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.event", () => parseEventCanonical(value));
}

export function npRequireAgentEventCanonical(value: unknown): NpAgentEventCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentEventCanonical(value),
    "Invalid Agent event canonical body",
  );
}

export function npBuildAgentEventCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-event.v1", NpAgentEventCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    EVENT_PURPOSE,
    npRequireAgentEventCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<"np.agent-event.v1", NpAgentEventCanonicalV1>;
}

export async function npDigestAgentEventCanonical(value: unknown): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(npBuildAgentEventCanonicalBytes(value).domainSeparatedUtf8);
}

export function npAnalyzeAgentSignalEvidenceCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentSignalEvidenceCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.signalEvidence", () =>
    parseSignalEvidenceCanonical(value),
  );
}

export function npRequireAgentSignalEvidenceCanonical(
  value: unknown,
): NpAgentSignalEvidenceCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentSignalEvidenceCanonical(value),
    "Invalid Agent signal-evidence canonical body",
  );
}

export function npBuildAgentSignalEvidenceCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-signal-evidence.v1", NpAgentSignalEvidenceCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    SIGNAL_PURPOSE,
    npRequireAgentSignalEvidenceCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-signal-evidence.v1",
    NpAgentSignalEvidenceCanonicalV1
  >;
}

export async function npDigestAgentSignalEvidenceCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentSignalEvidenceCanonicalBytes(value).domainSeparatedUtf8,
  );
}
