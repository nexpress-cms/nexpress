import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyCapabilities,
  canonicalBodyCapabilityId,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  digestAgentCanonicalSha256,
  macAgentCanonicalHmacSha256,
  verifyAgentCanonicalHmacSha256,
} from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  npAgentApprovalDecisions,
  npAgentApprovalRevocationKinds,
  npAgentApprovalRisks,
  npAgentHumanPredicates,
  npAgentScopes,
  type NpAgentApprovalDecisionBindingV1,
  type NpAgentApprovalDecisionCanonicalV1,
  type NpAgentApprovalDecisionReauthenticationV1,
  type NpAgentApprovalIntegrityKeyV1,
  type NpAgentApprovalReauthenticationRequirementV1,
  type NpAgentApprovalRequesterV1,
  type NpAgentApprovalRevocationCanonicalV1,
  type NpAgentApprovalStatementBindingV1,
  type NpAgentApprovalStatementCanonicalV1,
  type NpAgentApprovalTargetV1,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentHumanPredicate,
  type NpAgentScope,
} from "./types.js";

const STATEMENT_PURPOSE = "np.agent-approval-statement.v1" as const;
const DECISION_PURPOSE = "np.agent-approval-decision.v1" as const;
const REVOCATION_PURPOSE = "np.agent-approval-revocation.v1" as const;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const FINGERPRINT_CHARACTERS = 256;
const OPERATOR_TEXT_CHARACTERS = 4_000;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REVOCATION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;
const BASE64URL_SHA_256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const REQUESTER_KINDS = new Set<string>(["principal", "staff"]);
const TARGET_KINDS = new Set<string>(["changeset", "changeset_rollback", "action"]);
const REAUTHENTICATION_MODES = new Set<string>(["none", "recent"]);
const REAUTHENTICATION_ASSURANCES = new Set<string>(["staff-primary"]);
const APPROVAL_RISKS = new Set<string>(npAgentApprovalRisks);
const APPROVAL_DECISIONS = new Set<string>(npAgentApprovalDecisions);
const REVOCATION_KINDS = new Set<string>(npAgentApprovalRevocationKinds);
const AGENT_SCOPES = new Set<string>(npAgentScopes);
const HUMAN_PREDICATES = new Set<string>(npAgentHumanPredicates);

export const npAgentApprovalStatementCanonicalIncludedKeysV1 = [
  "version",
  "siteId",
  "approvalId",
  "requester",
  "target",
  "capabilityId",
  "capabilityContractVersion",
  "capabilityFingerprint",
  "requiredScopes",
  "requiredHumanCapabilities",
  "requiredHumanPredicates",
  "policyHashes",
  "requiresLivePreview",
  "previewId",
  "previewDigest",
  "risk",
  "reauthentication",
  "createdAt",
  "expiresAt",
] as const satisfies readonly (keyof NpAgentApprovalStatementCanonicalV1)[];

export const npAgentApprovalStatementCanonicalExcludedKeysV1 = [
  "requiredScopesDigest",
  "requiredHumanCapabilitiesDigest",
  "requiredHumanPredicatesDigest",
  "argumentsDigest",
  "targetVersionDigest",
  "validationDigest",
  "statementHash",
  "statementMac",
  "integrityKeyId",
  "generation",
  "approvalVersion",
  "challengeGeneration",
  "challengePurpose",
  "challengeHash",
  "challengeHashKeyId",
  "state",
  "decidedAt",
  "consumedAt",
  "revokedAt",
] as const;

export const npAgentApprovalDecisionCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "approvalId",
  "approvalGeneration",
  "statementHash",
  "decision",
  "deciderFingerprint",
  "currentHumanCapabilities",
  "reason",
  "reauthentication",
  "decidedAt",
] as const satisfies readonly (keyof NpAgentApprovalDecisionCanonicalV1)[];

export const npAgentApprovalDecisionCanonicalExcludedKeysV1 = [
  "currentHumanCapabilitiesDigest",
  "decisionHash",
  "decisionMac",
  "integrityKeyId",
  "approvalVersion",
  "challengeGeneration",
  "challenge",
  "challengeHash",
  "challengeHashKeyId",
  "challengeSessionFingerprint",
  "challengeExpiresAt",
  "challengeConsumedAt",
  "decidedByUserId",
  "state",
] as const;

export const npAgentApprovalRevocationCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "approvalId",
  "approvalGeneration",
  "statementHash",
  "decisionHash",
  "revocationKind",
  "revokerFingerprint",
  "revocationCode",
  "revocationReason",
  "revokedAt",
] as const satisfies readonly (keyof NpAgentApprovalRevocationCanonicalV1)[];

export const npAgentApprovalRevocationCanonicalExcludedKeysV1 = [
  "revocationHash",
  "revocationMac",
  "revocationIntegrityKeyId",
  "revokedByUserId",
  "approvalVersion",
  "challengeGeneration",
  "challenge",
  "challengeHash",
  "challengeHashKeyId",
  "state",
] as const;

export const npAgentApprovalStatementCanonicalPrincipalRequesterIncludedKeysV1 = [
  "kind",
  "principalId",
  "fingerprint",
] as const satisfies readonly (keyof Extract<NpAgentApprovalRequesterV1, { kind: "principal" }>)[];

export const npAgentApprovalStatementCanonicalStaffRequesterIncludedKeysV1 = [
  "kind",
  "userId",
  "fingerprint",
] as const satisfies readonly (keyof Extract<NpAgentApprovalRequesterV1, { kind: "staff" }>)[];

export const npAgentApprovalStatementCanonicalChangeSetTargetIncludedKeysV1 = [
  "kind",
  "changeSetId",
  "planHash",
] as const satisfies readonly (keyof Extract<NpAgentApprovalTargetV1, { kind: "changeset" }>)[];

export const npAgentApprovalStatementCanonicalRollbackTargetIncludedKeysV1 = [
  "kind",
  "changeSetId",
  "rollbackPlanId",
  "planHash",
] as const satisfies readonly (keyof Extract<
  NpAgentApprovalTargetV1,
  { kind: "changeset_rollback" }
>)[];

export const npAgentApprovalStatementCanonicalActionTargetIncludedKeysV1 = [
  "kind",
  "actionId",
  "runId",
  "agentId",
  "proposalHash",
] as const satisfies readonly (keyof Extract<NpAgentApprovalTargetV1, { kind: "action" }>)[];

export const npAgentApprovalStatementCanonicalNoneReauthenticationIncludedKeysV1 = [
  "mode",
] as const satisfies readonly (keyof Extract<
  NpAgentApprovalReauthenticationRequirementV1,
  { mode: "none" }
>)[];

export const npAgentApprovalStatementCanonicalRecentReauthenticationIncludedKeysV1 = [
  "mode",
  "maxAgeSeconds",
  "assurance",
] as const satisfies readonly (keyof Extract<
  NpAgentApprovalReauthenticationRequirementV1,
  { mode: "recent" }
>)[];

export const npAgentApprovalDecisionCanonicalNoneReauthenticationIncludedKeysV1 = [
  "mode",
] as const satisfies readonly (keyof Extract<
  NpAgentApprovalDecisionReauthenticationV1,
  { mode: "none" }
>)[];

export const npAgentApprovalDecisionCanonicalRecentReauthenticationIncludedKeysV1 = [
  "mode",
  "assurance",
  "maxAgeSeconds",
  "reauthenticatedAt",
  "sessionFactFingerprint",
] as const satisfies readonly (keyof Extract<
  NpAgentApprovalDecisionReauthenticationV1,
  { mode: "recent" }
>)[];

export const npAgentApprovalCanonicalDiscriminatorCasesV1 = [
  {
    caseId: "np.agent-approval-statement.v1.requester.principal",
    concreteDiscriminatorPath: "/requester/kind",
    acceptedValue: "principal",
  },
  {
    caseId: "np.agent-approval-statement.v1.requester.staff",
    concreteDiscriminatorPath: "/requester/kind",
    acceptedValue: "staff",
  },
  {
    caseId: "np.agent-approval-statement.v1.target.changeset",
    concreteDiscriminatorPath: "/target/kind",
    acceptedValue: "changeset",
  },
  {
    caseId: "np.agent-approval-statement.v1.target.changeset_rollback",
    concreteDiscriminatorPath: "/target/kind",
    acceptedValue: "changeset_rollback",
  },
  {
    caseId: "np.agent-approval-statement.v1.target.action",
    concreteDiscriminatorPath: "/target/kind",
    acceptedValue: "action",
  },
  {
    caseId: "np.agent-approval-statement.v1.reauthentication.none",
    concreteDiscriminatorPath: "/reauthentication/mode",
    acceptedValue: "none",
  },
  {
    caseId: "np.agent-approval-statement.v1.reauthentication.recent",
    concreteDiscriminatorPath: "/reauthentication/mode",
    acceptedValue: "recent",
  },
] as const;

const REQUESTER_KEYS = ["kind", "principalId", "userId", "fingerprint"] as const;
const TARGET_KEYS = [
  "kind",
  "changeSetId",
  "rollbackPlanId",
  "planHash",
  "actionId",
  "runId",
  "agentId",
  "proposalHash",
] as const;
const STATEMENT_REAUTHENTICATION_KEYS = ["mode", "maxAgeSeconds", "assurance"] as const;
const DECISION_REAUTHENTICATION_KEYS = [
  "mode",
  "assurance",
  "maxAgeSeconds",
  "reauthenticatedAt",
  "sessionFactFingerprint",
] as const;

function requireBranchKeys(
  record: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      failCanonicalBody("unknown-field", `${path}.${key}`, "is not part of this exact branch");
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) {
      failCanonicalBody("missing-field", `${path}.${key}`, "is required");
    }
  }
}

function canonicalBodyBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    failCanonicalBody("invalid-field", path, "must be a boolean");
  }
  return value;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function canonicalBodyOperatorText(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length > OPERATOR_TEXT_CHARACTERS ||
    hasLoneSurrogate(value)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be at most ${OPERATOR_TEXT_CHARACTERS.toString()} safe text characters`,
    );
  }
  return value;
}

function parseSortedUniqueEnum<T extends string>(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
  allowed: ReadonlySet<string>,
  maximum: number,
): T[] {
  const entries = canonicalBodyArray(value, path, maximum, state);
  const result: T[] = [];
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const current = canonicalBodyEnum<T>(entry, `${path}[${index.toString()}]`, allowed);
    if (previous !== null && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by canonical value",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseSortedUniqueDigests(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): string[] {
  const entries = canonicalBodyArray(value, path, 262_144, state);
  const result: string[] = [];
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const current = canonicalBodySha256Digest(entry, `${path}[${index.toString()}]`);
    if (previous !== null && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by canonical digest",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseRequester(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentApprovalRequesterV1 {
  const record = canonicalBodyRecord(value, path, REQUESTER_KEYS, ["kind"], state);
  const kind = canonicalBodyEnum<NpAgentApprovalRequesterV1["kind"]>(
    record.kind,
    `${path}.kind`,
    REQUESTER_KINDS,
  );
  if (kind === "principal") {
    requireBranchKeys(
      record,
      path,
      npAgentApprovalStatementCanonicalPrincipalRequesterIncludedKeysV1,
    );
    return {
      kind,
      principalId: canonicalBodyUuid(record.principalId, `${path}.principalId`),
      fingerprint: canonicalBodyAscii(
        record.fingerprint,
        `${path}.fingerprint`,
        FINGERPRINT_CHARACTERS,
      ),
    };
  }
  requireBranchKeys(record, path, npAgentApprovalStatementCanonicalStaffRequesterIncludedKeysV1);
  return {
    kind,
    userId: record.userId === null ? null : canonicalBodyUuid(record.userId, `${path}.userId`),
    fingerprint: canonicalBodyAscii(
      record.fingerprint,
      `${path}.fingerprint`,
      FINGERPRINT_CHARACTERS,
    ),
  };
}

function parseTarget(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentApprovalTargetV1 {
  const record = canonicalBodyRecord(value, path, TARGET_KEYS, ["kind"], state);
  const kind = canonicalBodyEnum<NpAgentApprovalTargetV1["kind"]>(
    record.kind,
    `${path}.kind`,
    TARGET_KINDS,
  );
  if (kind === "changeset") {
    requireBranchKeys(record, path, npAgentApprovalStatementCanonicalChangeSetTargetIncludedKeysV1);
    return {
      kind,
      changeSetId: canonicalBodyUuid(record.changeSetId, `${path}.changeSetId`),
      planHash: canonicalBodySha256Digest(record.planHash, `${path}.planHash`),
    };
  }
  if (kind === "changeset_rollback") {
    requireBranchKeys(record, path, npAgentApprovalStatementCanonicalRollbackTargetIncludedKeysV1);
    return {
      kind,
      changeSetId: canonicalBodyUuid(record.changeSetId, `${path}.changeSetId`),
      rollbackPlanId: canonicalBodyUuid(record.rollbackPlanId, `${path}.rollbackPlanId`),
      planHash: canonicalBodySha256Digest(record.planHash, `${path}.planHash`),
    };
  }
  requireBranchKeys(record, path, npAgentApprovalStatementCanonicalActionTargetIncludedKeysV1);
  return {
    kind,
    actionId: canonicalBodyUuid(record.actionId, `${path}.actionId`),
    runId: record.runId === null ? null : canonicalBodyUuid(record.runId, `${path}.runId`),
    agentId: record.agentId === null ? null : canonicalBodyUuid(record.agentId, `${path}.agentId`),
    proposalHash: canonicalBodySha256Digest(record.proposalHash, `${path}.proposalHash`),
  };
}

function parseStatementReauthentication(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentApprovalReauthenticationRequirementV1 {
  const record = canonicalBodyRecord(value, path, STATEMENT_REAUTHENTICATION_KEYS, ["mode"], state);
  const mode = canonicalBodyEnum<"none" | "recent">(
    record.mode,
    `${path}.mode`,
    REAUTHENTICATION_MODES,
  );
  if (mode === "none") {
    requireBranchKeys(
      record,
      path,
      npAgentApprovalStatementCanonicalNoneReauthenticationIncludedKeysV1,
    );
    return { mode };
  }
  requireBranchKeys(
    record,
    path,
    npAgentApprovalStatementCanonicalRecentReauthenticationIncludedKeysV1,
  );
  return {
    mode,
    maxAgeSeconds: canonicalBodyInteger(record.maxAgeSeconds, `${path}.maxAgeSeconds`, 1, 300),
    assurance: canonicalBodyEnum<"staff-primary">(
      record.assurance,
      `${path}.assurance`,
      REAUTHENTICATION_ASSURANCES,
    ),
  };
}

function parseDecisionReauthentication(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentApprovalDecisionReauthenticationV1 {
  const record = canonicalBodyRecord(value, path, DECISION_REAUTHENTICATION_KEYS, ["mode"], state);
  const mode = canonicalBodyEnum<"none" | "recent">(
    record.mode,
    `${path}.mode`,
    REAUTHENTICATION_MODES,
  );
  if (mode === "none") {
    requireBranchKeys(
      record,
      path,
      npAgentApprovalDecisionCanonicalNoneReauthenticationIncludedKeysV1,
    );
    return { mode };
  }
  requireBranchKeys(
    record,
    path,
    npAgentApprovalDecisionCanonicalRecentReauthenticationIncludedKeysV1,
  );
  return {
    mode,
    assurance: canonicalBodyEnum<"staff-primary">(
      record.assurance,
      `${path}.assurance`,
      REAUTHENTICATION_ASSURANCES,
    ),
    maxAgeSeconds: canonicalBodyInteger(record.maxAgeSeconds, `${path}.maxAgeSeconds`, 1, 300),
    reauthenticatedAt: canonicalBodyUtc(record.reauthenticatedAt, `${path}.reauthenticatedAt`),
    sessionFactFingerprint: canonicalBodySha256Digest(
      record.sessionFactFingerprint,
      `${path}.sessionFactFingerprint`,
    ),
  };
}

function parseApprovalStatementCanonical(value: unknown): NpAgentApprovalStatementCanonicalV1 {
  const path = "agent.canonical.approvalStatement";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentApprovalStatementCanonicalIncludedKeysV1,
    npAgentApprovalStatementCanonicalIncludedKeysV1,
    state,
  );
  if (record.version !== STATEMENT_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.version`, `must be ${STATEMENT_PURPOSE}`);
  }
  const requiresLivePreview = canonicalBodyBoolean(
    record.requiresLivePreview,
    `${path}.requiresLivePreview`,
  );
  const previewId =
    record.previewId === null ? null : canonicalBodyUuid(record.previewId, `${path}.previewId`);
  const previewDigest =
    record.previewDigest === null
      ? null
      : canonicalBodySha256Digest(record.previewDigest, `${path}.previewDigest`);
  if (requiresLivePreview !== (previewId !== null && previewDigest !== null)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.requiresLivePreview`,
      "must be true exactly when previewId and previewDigest are both non-null",
    );
  }
  if (!requiresLivePreview && (previewId !== null || previewDigest !== null)) {
    failCanonicalBody(
      "invalid-field",
      previewId !== null ? `${path}.previewId` : `${path}.previewDigest`,
      "must be null when live preview is not required",
    );
  }
  const risk = canonicalBodyEnum<NpAgentApprovalStatementCanonicalV1["risk"]>(
    record.risk,
    `${path}.risk`,
    APPROVAL_RISKS,
  );
  const reauthentication = parseStatementReauthentication(
    record.reauthentication,
    `${path}.reauthentication`,
    state,
  );
  if (risk !== "reversible" && reauthentication.mode !== "recent") {
    failCanonicalBody(
      "invalid-field",
      `${path}.reauthentication.mode`,
      "sensitive and destructive approvals require recent staff-primary reauthentication",
    );
  }
  const createdAt = canonicalBodyUtc(record.createdAt, `${path}.createdAt`);
  const expiresAt = canonicalBodyUtc(record.expiresAt, `${path}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    failCanonicalBody("invalid-field", `${path}.expiresAt`, "must be later than createdAt");
  }
  const result: NpAgentApprovalStatementCanonicalV1 = {
    version: STATEMENT_PURPOSE,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    approvalId: canonicalBodyUuid(record.approvalId, `${path}.approvalId`),
    requester: parseRequester(record.requester, `${path}.requester`, state),
    target: parseTarget(record.target, `${path}.target`, state),
    capabilityId: canonicalBodyCapabilityId(record.capabilityId, `${path}.capabilityId`),
    capabilityContractVersion: canonicalBodyInteger(
      record.capabilityContractVersion,
      `${path}.capabilityContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    capabilityFingerprint: canonicalBodySha256Digest(
      record.capabilityFingerprint,
      `${path}.capabilityFingerprint`,
    ),
    requiredScopes: parseSortedUniqueEnum<NpAgentScope>(
      record.requiredScopes,
      `${path}.requiredScopes`,
      state,
      AGENT_SCOPES,
      npAgentScopes.length,
    ),
    requiredHumanCapabilities: canonicalBodyCapabilities(
      record.requiredHumanCapabilities,
      `${path}.requiredHumanCapabilities`,
      state,
    ),
    requiredHumanPredicates: parseSortedUniqueEnum<NpAgentHumanPredicate>(
      record.requiredHumanPredicates,
      `${path}.requiredHumanPredicates`,
      state,
      HUMAN_PREDICATES,
      npAgentHumanPredicates.length,
    ),
    policyHashes: parseSortedUniqueDigests(record.policyHashes, `${path}.policyHashes`, state),
    requiresLivePreview,
    previewId,
    previewDigest,
    risk,
    reauthentication,
    createdAt,
    expiresAt,
  };
  buildAgentCanonicalFoundationBytes(STATEMENT_PURPOSE, result);
  return result;
}

function parseApprovalDecisionCanonical(value: unknown): NpAgentApprovalDecisionCanonicalV1 {
  const path = "agent.canonical.approvalDecision";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentApprovalDecisionCanonicalIncludedKeysV1,
    npAgentApprovalDecisionCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== DECISION_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${DECISION_PURPOSE}`);
  }
  const decision = canonicalBodyEnum<NpAgentApprovalDecisionCanonicalV1["decision"]>(
    record.decision,
    `${path}.decision`,
    APPROVAL_DECISIONS,
  );
  const reauthentication = parseDecisionReauthentication(
    record.reauthentication,
    `${path}.reauthentication`,
    state,
  );
  if (decision === "reject" && reauthentication.mode !== "none") {
    failCanonicalBody(
      "invalid-field",
      `${path}.reauthentication.mode`,
      "rejected decisions must use none",
    );
  }
  const decidedAt = canonicalBodyUtc(record.decidedAt, `${path}.decidedAt`);
  if (reauthentication.mode === "recent") {
    const ageMilliseconds = Date.parse(decidedAt) - Date.parse(reauthentication.reauthenticatedAt);
    if (ageMilliseconds < 0 || ageMilliseconds > reauthentication.maxAgeSeconds * 1_000) {
      failCanonicalBody(
        "invalid-field",
        `${path}.reauthentication.reauthenticatedAt`,
        "must be at or before decidedAt within maxAgeSeconds",
      );
    }
  }
  const result: NpAgentApprovalDecisionCanonicalV1 = {
    schemaVersion: DECISION_PURPOSE,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    approvalId: canonicalBodyUuid(record.approvalId, `${path}.approvalId`),
    approvalGeneration: canonicalBodyInteger(
      record.approvalGeneration,
      `${path}.approvalGeneration`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    statementHash: canonicalBodySha256Digest(record.statementHash, `${path}.statementHash`),
    decision,
    deciderFingerprint: canonicalBodyAscii(
      record.deciderFingerprint,
      `${path}.deciderFingerprint`,
      FINGERPRINT_CHARACTERS,
    ),
    currentHumanCapabilities: canonicalBodyCapabilities(
      record.currentHumanCapabilities,
      `${path}.currentHumanCapabilities`,
      state,
    ),
    reason:
      record.reason === null ? null : canonicalBodyOperatorText(record.reason, `${path}.reason`),
    reauthentication,
    decidedAt,
  };
  buildAgentCanonicalFoundationBytes(DECISION_PURPOSE, result);
  return result;
}

function parseApprovalRevocationCanonical(value: unknown): NpAgentApprovalRevocationCanonicalV1 {
  const path = "agent.canonical.approvalRevocation";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentApprovalRevocationCanonicalIncludedKeysV1,
    npAgentApprovalRevocationCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== REVOCATION_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${REVOCATION_PURPOSE}`);
  }
  const revocationKind = canonicalBodyEnum<NpAgentApprovalRevocationCanonicalV1["revocationKind"]>(
    record.revocationKind,
    `${path}.revocationKind`,
    REVOCATION_KINDS,
  );
  const revocationReason =
    record.revocationReason === null
      ? null
      : canonicalBodyOperatorText(record.revocationReason, `${path}.revocationReason`);
  if (revocationKind !== "human" && revocationReason !== null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.revocationReason`,
      "non-human revocations require null",
    );
  }
  if (
    typeof record.revocationCode !== "string" ||
    !REVOCATION_CODE_PATTERN.test(record.revocationCode)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.revocationCode`,
      "must be a stable uppercase reason code",
    );
  }
  const result: NpAgentApprovalRevocationCanonicalV1 = {
    schemaVersion: REVOCATION_PURPOSE,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    approvalId: canonicalBodyUuid(record.approvalId, `${path}.approvalId`),
    approvalGeneration: canonicalBodyInteger(
      record.approvalGeneration,
      `${path}.approvalGeneration`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    statementHash: canonicalBodySha256Digest(record.statementHash, `${path}.statementHash`),
    decisionHash:
      record.decisionHash === null
        ? null
        : canonicalBodySha256Digest(record.decisionHash, `${path}.decisionHash`),
    revocationKind,
    revokerFingerprint: canonicalBodyAscii(
      record.revokerFingerprint,
      `${path}.revokerFingerprint`,
      FINGERPRINT_CHARACTERS,
    ),
    revocationCode: record.revocationCode,
    revocationReason,
    revokedAt: canonicalBodyUtc(record.revokedAt, `${path}.revokedAt`),
  };
  buildAgentCanonicalFoundationBytes(REVOCATION_PURPOSE, result);
  return result;
}

function requireEqual(actual: unknown, expected: unknown, path: string, label: string): void {
  if (actual !== expected) {
    failCanonicalBody("invalid-field", path, `must equal the bound ${label}`);
  }
}

async function requireVerifiedStatementBinding(
  value: unknown,
): Promise<NpAgentApprovalStatementBindingV1> {
  const path = "agent.canonical.approvalStatementBinding";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    ["statement", "statementHash", "approvalGeneration"],
    ["statement", "statementHash", "approvalGeneration"],
    state,
  );
  const statement = parseApprovalStatementCanonical(record.statement);
  const statementHash = canonicalBodySha256Digest(record.statementHash, `${path}.statementHash`);
  const computedHash = await digestAgentCanonicalSha256(
    buildAgentCanonicalFoundationBytes(STATEMENT_PURPOSE, statement).domainSeparatedUtf8,
  );
  requireEqual(statementHash, computedHash, `${path}.statementHash`, "statement digest");
  return {
    statement,
    statementHash,
    approvalGeneration: canonicalBodyInteger(
      record.approvalGeneration,
      `${path}.approvalGeneration`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
  };
}

function validateDecisionBinding(
  decision: NpAgentApprovalDecisionCanonicalV1,
  binding: NpAgentApprovalStatementBindingV1,
): void {
  const path = "agent.canonical.approvalDecision";
  const statement = binding.statement;
  requireEqual(decision.siteId, statement.siteId, `${path}.siteId`, "statement siteId");
  requireEqual(
    decision.approvalId,
    statement.approvalId,
    `${path}.approvalId`,
    "statement approvalId",
  );
  requireEqual(
    decision.approvalGeneration,
    binding.approvalGeneration,
    `${path}.approvalGeneration`,
    "approval generation",
  );
  requireEqual(
    decision.statementHash,
    binding.statementHash,
    `${path}.statementHash`,
    "statement hash",
  );
  const decidedMilliseconds = Date.parse(decision.decidedAt);
  if (
    decidedMilliseconds < Date.parse(statement.createdAt) ||
    decidedMilliseconds >= Date.parse(statement.expiresAt)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.decidedAt`,
      "must fall within the bound statement lifetime",
    );
  }
  if (decision.decision === "reject") return;
  const currentCapabilities = new Set(decision.currentHumanCapabilities);
  for (const capability of statement.requiredHumanCapabilities) {
    if (!currentCapabilities.has(capability)) {
      failCanonicalBody(
        "invalid-field",
        `${path}.currentHumanCapabilities`,
        `must contain required capability ${capability}`,
      );
    }
  }
  if (statement.reauthentication.mode === "none") {
    if (decision.reauthentication.mode !== "none") {
      failCanonicalBody(
        "invalid-field",
        `${path}.reauthentication.mode`,
        "must equal the statement reauthentication mode",
      );
    }
    return;
  }
  if (
    decision.reauthentication.mode !== "recent" ||
    decision.reauthentication.assurance !== statement.reauthentication.assurance ||
    decision.reauthentication.maxAgeSeconds !== statement.reauthentication.maxAgeSeconds
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.reauthentication`,
      "must equal the bound statement requirement and add the actual fact",
    );
  }
}

async function requireDecisionForStatement(
  value: unknown,
  statementBindingValue: unknown,
): Promise<{
  decision: NpAgentApprovalDecisionCanonicalV1;
  statementBinding: NpAgentApprovalStatementBindingV1;
}> {
  const statementBinding = await requireVerifiedStatementBinding(statementBindingValue);
  const decision = parseApprovalDecisionCanonical(value);
  validateDecisionBinding(decision, statementBinding);
  return { decision, statementBinding };
}

async function requireVerifiedDecisionBinding(
  value: unknown,
  statementBinding: NpAgentApprovalStatementBindingV1,
): Promise<NpAgentApprovalDecisionBindingV1> {
  const path = "agent.canonical.approvalDecisionBinding";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    ["decision", "decisionHash"],
    ["decision", "decisionHash"],
    state,
  );
  const decision = parseApprovalDecisionCanonical(record.decision);
  validateDecisionBinding(decision, statementBinding);
  const decisionHash = canonicalBodySha256Digest(record.decisionHash, `${path}.decisionHash`);
  const computedHash = await digestAgentCanonicalSha256(
    buildAgentCanonicalFoundationBytes(DECISION_PURPOSE, decision).domainSeparatedUtf8,
  );
  requireEqual(decisionHash, computedHash, `${path}.decisionHash`, "decision digest");
  return { decision, decisionHash };
}

async function requireRevocationForBindings(
  value: unknown,
  statementBindingValue: unknown,
  decisionBindingValue: unknown,
): Promise<NpAgentApprovalRevocationCanonicalV1> {
  const statementBinding = await requireVerifiedStatementBinding(statementBindingValue);
  const decisionBinding =
    decisionBindingValue === null
      ? null
      : await requireVerifiedDecisionBinding(decisionBindingValue, statementBinding);
  const revocation = parseApprovalRevocationCanonical(value);
  const path = "agent.canonical.approvalRevocation";
  requireEqual(
    revocation.siteId,
    statementBinding.statement.siteId,
    `${path}.siteId`,
    "statement siteId",
  );
  requireEqual(
    revocation.approvalId,
    statementBinding.statement.approvalId,
    `${path}.approvalId`,
    "statement approvalId",
  );
  requireEqual(
    revocation.approvalGeneration,
    statementBinding.approvalGeneration,
    `${path}.approvalGeneration`,
    "approval generation",
  );
  requireEqual(
    revocation.statementHash,
    statementBinding.statementHash,
    `${path}.statementHash`,
    "statement hash",
  );
  requireEqual(
    revocation.decisionHash,
    decisionBinding?.decisionHash ?? null,
    `${path}.decisionHash`,
    "prior decision hash",
  );
  const revokedMilliseconds = Date.parse(revocation.revokedAt);
  if (revokedMilliseconds < Date.parse(statementBinding.statement.createdAt)) {
    failCanonicalBody("invalid-field", `${path}.revokedAt`, "must not predate the statement");
  }
  if (decisionBinding && revokedMilliseconds < Date.parse(decisionBinding.decision.decidedAt)) {
    failCanonicalBody("invalid-field", `${path}.revokedAt`, "must not predate the decision");
  }
  return revocation;
}

function parseApprovalIntegrityKey(value: unknown): NpAgentApprovalIntegrityKeyV1 {
  const path = "agent.canonical.approvalIntegrityKey";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be an ordinary plain object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    failCanonicalBody("shape", path, "must use the ordinary object prototype");
  }
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !new Set(["owner", "id", "bytes"]).has(key)) {
      failCanonicalBody("unknown-field", path, "contains an unknown key field");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      failCanonicalBody("shape", `${path}.${key}`, "must be an enumerable plain data property");
    }
    record[key] = descriptor.value as unknown;
  }
  for (const key of ["owner", "id", "bytes"] as const) {
    if (!Object.hasOwn(record, key)) {
      failCanonicalBody("missing-field", `${path}.${key}`, "is required");
    }
  }
  if (record.owner !== "approval-integrity") {
    failCanonicalBody("invalid-field", `${path}.owner`, "must be approval-integrity");
  }
  if (typeof record.id !== "string" || !KEY_ID_PATTERN.test(record.id)) {
    failCanonicalBody("invalid-field", `${path}.id`, "must be one bounded non-secret key id");
  }
  if (!(record.bytes instanceof Uint8Array) || record.bytes.byteLength === 0) {
    failCanonicalBody("invalid-field", `${path}.bytes`, "must contain non-empty HMAC key bytes");
  }
  return {
    owner: "approval-integrity",
    id: record.id,
    bytes: new Uint8Array(record.bytes),
  };
}

function decodeBase64UrlSha256(value: string): Uint8Array | null {
  if (!BASE64URL_SHA_256_PATTERN.test(value)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const result: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    accumulator = accumulator * 64 + digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result.push(Math.floor(accumulator / 2 ** bits) & 0xff);
      accumulator %= 2 ** bits;
    }
  }
  if (result.length !== 32 || accumulator !== 0) return null;
  return Uint8Array.from(result);
}

function parseExpectedApprovalMac(value: unknown, keyId: string): Uint8Array | null {
  if (typeof value !== "string") return null;
  const prefix = `cj1:hmac-sha256:${keyId}:`;
  if (!value.startsWith(prefix)) return null;
  return decodeBase64UrlSha256(value.slice(prefix.length));
}

async function macApprovalBytes(
  bytes: Uint8Array,
  keyValue: unknown,
): Promise<`cj1:hmac-sha256:${string}:${string}`> {
  const key = parseApprovalIntegrityKey(keyValue);
  const mac = await macAgentCanonicalHmacSha256(bytes, key.bytes);
  return `cj1:hmac-sha256:${key.id}:${mac}`;
}

async function verifyApprovalBytes(
  bytes: Uint8Array,
  expectedMac: unknown,
  keyValue: unknown,
): Promise<boolean> {
  const key = parseApprovalIntegrityKey(keyValue);
  const decoded = parseExpectedApprovalMac(expectedMac, key.id);
  if (decoded === null) return false;
  return verifyAgentCanonicalHmacSha256(bytes, key.bytes, decoded);
}

export function npAnalyzeAgentApprovalStatementCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentApprovalStatementCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.approvalStatement", () =>
    parseApprovalStatementCanonical(value),
  );
}

export function npRequireAgentApprovalStatementCanonical(
  value: unknown,
): NpAgentApprovalStatementCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentApprovalStatementCanonical(value),
    "Invalid Agent approval-statement canonical body",
  );
}

export function npBuildAgentApprovalStatementCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-approval-statement.v1",
  NpAgentApprovalStatementCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    STATEMENT_PURPOSE,
    npRequireAgentApprovalStatementCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-approval-statement.v1",
    NpAgentApprovalStatementCanonicalV1
  >;
}

export async function npDigestAgentApprovalStatementCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentApprovalStatementCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export async function npMacAgentApprovalStatementCanonical(
  value: unknown,
  key: unknown,
): Promise<`cj1:hmac-sha256:${string}:${string}`> {
  return macApprovalBytes(
    npBuildAgentApprovalStatementCanonicalBytes(value).domainSeparatedUtf8,
    key,
  );
}

export async function npVerifyAgentApprovalStatementCanonicalMac(
  value: unknown,
  expectedMac: unknown,
  key: unknown,
): Promise<boolean> {
  return verifyApprovalBytes(
    npBuildAgentApprovalStatementCanonicalBytes(value).domainSeparatedUtf8,
    expectedMac,
    key,
  );
}

export function npAnalyzeAgentApprovalDecisionCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentApprovalDecisionCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.approvalDecision", () =>
    parseApprovalDecisionCanonical(value),
  );
}

export function npRequireAgentApprovalDecisionCanonical(
  value: unknown,
): NpAgentApprovalDecisionCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentApprovalDecisionCanonical(value),
    "Invalid Agent approval-decision canonical body",
  );
}

export async function npRequireAgentApprovalDecisionCanonicalForStatement(
  value: unknown,
  statementBinding: unknown,
): Promise<NpAgentApprovalDecisionCanonicalV1> {
  return (await requireDecisionForStatement(value, statementBinding)).decision;
}

export async function npBuildAgentApprovalDecisionCanonicalBytes(
  value: unknown,
  statementBinding: unknown,
): Promise<
  NpAgentCanonicalBodyBytesV1<"np.agent-approval-decision.v1", NpAgentApprovalDecisionCanonicalV1>
> {
  const decision = await npRequireAgentApprovalDecisionCanonicalForStatement(
    value,
    statementBinding,
  );
  return buildAgentCanonicalFoundationBytes(
    DECISION_PURPOSE,
    decision,
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-approval-decision.v1",
    NpAgentApprovalDecisionCanonicalV1
  >;
}

export async function npDigestAgentApprovalDecisionCanonical(
  value: unknown,
  statementBinding: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    (await npBuildAgentApprovalDecisionCanonicalBytes(value, statementBinding)).domainSeparatedUtf8,
  );
}

export async function npMacAgentApprovalDecisionCanonical(
  value: unknown,
  statementBinding: unknown,
  key: unknown,
): Promise<`cj1:hmac-sha256:${string}:${string}`> {
  return macApprovalBytes(
    (await npBuildAgentApprovalDecisionCanonicalBytes(value, statementBinding)).domainSeparatedUtf8,
    key,
  );
}

export async function npVerifyAgentApprovalDecisionCanonicalMac(
  value: unknown,
  statementBinding: unknown,
  expectedMac: unknown,
  key: unknown,
): Promise<boolean> {
  return verifyApprovalBytes(
    (await npBuildAgentApprovalDecisionCanonicalBytes(value, statementBinding)).domainSeparatedUtf8,
    expectedMac,
    key,
  );
}

export function npAnalyzeAgentApprovalRevocationCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentApprovalRevocationCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.approvalRevocation", () =>
    parseApprovalRevocationCanonical(value),
  );
}

export function npRequireAgentApprovalRevocationCanonical(
  value: unknown,
): NpAgentApprovalRevocationCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentApprovalRevocationCanonical(value),
    "Invalid Agent approval-revocation canonical body",
  );
}

export async function npRequireAgentApprovalRevocationCanonicalForBindings(
  value: unknown,
  statementBinding: unknown,
  decisionBinding: unknown,
): Promise<NpAgentApprovalRevocationCanonicalV1> {
  return requireRevocationForBindings(value, statementBinding, decisionBinding);
}

export async function npBuildAgentApprovalRevocationCanonicalBytes(
  value: unknown,
  statementBinding: unknown,
  decisionBinding: unknown,
): Promise<
  NpAgentCanonicalBodyBytesV1<
    "np.agent-approval-revocation.v1",
    NpAgentApprovalRevocationCanonicalV1
  >
> {
  const revocation = await npRequireAgentApprovalRevocationCanonicalForBindings(
    value,
    statementBinding,
    decisionBinding,
  );
  return buildAgentCanonicalFoundationBytes(
    REVOCATION_PURPOSE,
    revocation,
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-approval-revocation.v1",
    NpAgentApprovalRevocationCanonicalV1
  >;
}

export async function npDigestAgentApprovalRevocationCanonical(
  value: unknown,
  statementBinding: unknown,
  decisionBinding: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    (await npBuildAgentApprovalRevocationCanonicalBytes(value, statementBinding, decisionBinding))
      .domainSeparatedUtf8,
  );
}

export async function npMacAgentApprovalRevocationCanonical(
  value: unknown,
  statementBinding: unknown,
  decisionBinding: unknown,
  key: unknown,
): Promise<`cj1:hmac-sha256:${string}:${string}`> {
  return macApprovalBytes(
    (await npBuildAgentApprovalRevocationCanonicalBytes(value, statementBinding, decisionBinding))
      .domainSeparatedUtf8,
    key,
  );
}

export async function npVerifyAgentApprovalRevocationCanonicalMac(
  value: unknown,
  statementBinding: unknown,
  decisionBinding: unknown,
  expectedMac: unknown,
  key: unknown,
): Promise<boolean> {
  return verifyApprovalBytes(
    (await npBuildAgentApprovalRevocationCanonicalBytes(value, statementBinding, decisionBinding))
      .domainSeparatedUtf8,
    expectedMac,
    key,
  );
}
