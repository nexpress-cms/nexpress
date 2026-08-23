import {
  npAnalyzeCollectionJsonValue,
  npCollectionContractLimits,
} from "../collection-contract/contract.js";
import {
  NpAgentContractError,
  npAgentContractLimits,
  npRequireAgentContractResult,
} from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyCapabilities,
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
  npAgentChangeSetOperationMatchesResourceKey,
  npAnalyzeAgentChangeSetOperationInput,
  npAnalyzeAgentChangeSetResourceKey,
  npAnalyzeAgentVersionBase,
} from "./changeset-contract.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  buildAgentCanonicalFoundationBytes,
  type AgentCanonicalJsonInspectionLimits,
} from "./canonical-foundation.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentChangeSetPlanKinds,
  npAgentChangeSetRollbackClasses,
  npAgentChangeSetSnapshotPresences,
  npAgentHumanPredicates,
  npAgentRiskLevels,
  npAgentRiskReasonCodes,
  npAgentScopes,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentChangeSetPlanCanonicalV1,
  type NpAgentChangeSetPlanKind,
  type NpAgentChangeSetOperationInput,
  type NpAgentChangeSetProposalCanonicalV1,
  type NpAgentChangeSetProposalOperationCanonicalV1,
  type NpAgentChangeSetResourceKeyV1,
  type NpAgentChangeSetRollbackClass,
  type NpAgentChangeSetSnapshotCanonicalV1,
  type NpAgentChangeSetSnapshotPresence,
  type NpAgentContractIssue,
  type NpAgentContractResult,
  type NpAgentHumanPredicate,
  type NpAgentInitialChangeSetPlanBodyV1,
  type NpAgentInitialChangeSetPlanOperationCanonicalV1,
  type NpAgentJsonValue,
  type NpAgentRiskLevel,
  type NpAgentRiskReasonCode,
  type NpAgentRiskSummary,
  type NpAgentRollbackChangeSetPlanBodyV1,
  type NpAgentRollbackChangeSetPlanOperationCanonicalV1,
  type NpAgentScope,
  type NpAgentVersionBaseV1,
} from "./types.js";

const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const ROLLBACK_WINDOW_MINIMUM_SECONDS = 60;
const ROLLBACK_WINDOW_MAXIMUM_SECONDS = 7_776_000;
const PLAN_KINDS = new Set<string>(npAgentChangeSetPlanKinds);
const ROLLBACK_CLASSES = new Set<string>(npAgentChangeSetRollbackClasses);
const SNAPSHOT_PRESENCES = new Set<string>(npAgentChangeSetSnapshotPresences);
const RISK_LEVELS = new Set<string>(npAgentRiskLevels);
const RISK_REASON_CODES = new Set<string>(npAgentRiskReasonCodes);
const SCOPES = new Set<string>(npAgentScopes);
const HUMAN_PREDICATES = new Set<string>(npAgentHumanPredicates);

const PROPOSAL_LIMITS: AgentCanonicalJsonInspectionLimits = {
  maximumDepth: npCollectionContractLimits.jsonDepth,
  maximumNodes: npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-proposal.v1"],
  maximumArrayItems: npCollectionContractLimits.arrayRows,
  maximumObjectProperties: npCollectionContractLimits.jsonKeys,
  maximumStringCharacters: npCollectionContractLimits.stringLength,
  maximumCanonicalBytes: npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-proposal.v1"],
};

const SNAPSHOT_LIMITS: AgentCanonicalJsonInspectionLimits = {
  ...PROPOSAL_LIMITS,
  maximumNodes: npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-snapshot.v1"],
  maximumCanonicalBytes: npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-snapshot.v1"],
};

const PLAN_LIMITS: AgentCanonicalJsonInspectionLimits = {
  ...PROPOSAL_LIMITS,
  maximumNodes: npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-plan.v1"],
  maximumCanonicalBytes: npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-plan.v1"],
};

export const npAgentChangeSetProposalCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "changeSetId",
  "draftVersion",
  "title",
  "summary",
  "operations",
] as const satisfies readonly (keyof NpAgentChangeSetProposalCanonicalV1)[];

export const npAgentChangeSetProposalCanonicalExcludedKeysV1 = [
  "draftHash",
  "planHash",
  "baseFingerprint",
  "risk",
  "validation",
  "validationDigest",
  "preview",
  "approval",
  "schedule",
  "execution",
  "verification",
  "rollback",
  "state",
  "createdAt",
  "updatedAt",
  "expiresAt",
] as const;

export const npAgentChangeSetProposalOperationCanonicalIncludedKeysV1 = [
  "ordinal",
  "operation",
  "canonicalResourceKey",
] as const satisfies readonly (keyof NpAgentChangeSetProposalOperationCanonicalV1)[];

export const npAgentChangeSetSnapshotCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "changeSetId",
  "operationOrdinal",
  "canonicalResourceKey",
  "presence",
  "base",
  "value",
] as const satisfies readonly (keyof NpAgentChangeSetSnapshotCanonicalV1)[];

export const npAgentChangeSetSnapshotCanonicalExcludedKeysV1 = [
  "snapshotHash",
  "capturedAt",
  "beforeHash",
  "afterHash",
  "applyResult",
  "verificationResult",
  "state",
  "errorCode",
  "expiresAt",
  "deletedAt",
] as const;

export const npAgentChangeSetPlanCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "planKind",
  "siteId",
  "changeSetId",
  "body",
] as const satisfies readonly (keyof NpAgentChangeSetPlanCanonicalV1)[];

export const npAgentChangeSetPlanCanonicalExcludedKeysV1 = [
  "planHash",
  "validationDigest",
  "title",
  "summary",
  "state",
  "preview",
  "previewDigest",
  "approval",
  "approvalId",
  "scheduledFor",
  "execution",
  "executionId",
  "executionResultDigest",
  "verification",
  "verificationDigest",
  "rollback",
  "rollbackEligibleUntil",
  "appliedAt",
  "verifiedAt",
  "rolledBackAt",
  "updatedAt",
] as const;

export const npAgentInitialChangeSetPlanBodyIncludedKeysV1 = [
  "draftVersion",
  "draftHash",
  "validationGeneration",
  "baseFingerprint",
  "operations",
  "risk",
  "requiredScopes",
  "requiredHumanCapabilities",
  "requiredHumanPredicates",
  "policyHashes",
  "expiresAt",
  "rollbackWindowSeconds",
] as const satisfies readonly (keyof NpAgentInitialChangeSetPlanBodyV1)[];

export const npAgentRollbackChangeSetPlanBodyIncludedKeysV1 = [
  "rollbackPlanId",
  "generation",
  "compensatesExecutionId",
  "originalPlanHash",
  "appliedResultDigest",
  "baseFingerprint",
  "operations",
  "risk",
  "requiredScopes",
  "requiredHumanCapabilities",
  "requiredHumanPredicates",
  "policyHashes",
  "expiresAt",
] as const satisfies readonly (keyof NpAgentRollbackChangeSetPlanBodyV1)[];

export const npAgentInitialChangeSetPlanOperationIncludedKeysV1 = [
  "ordinal",
  "operation",
  "canonicalResourceKey",
  "beforeHash",
  "proposedAfterHash",
  "snapshotHash",
  "rollbackClass",
  "residualCodes",
] as const satisfies readonly (keyof NpAgentInitialChangeSetPlanOperationCanonicalV1)[];

export const npAgentRollbackChangeSetPlanOperationIncludedKeysV1 = [
  "ordinal",
  "originalOperationOrdinal",
  "canonicalResourceKey",
  "originalSnapshotHash",
  "expectedCurrentHash",
  "expectedCurrentVersion",
  "compensationOperation",
  "proposedAfterHash",
  "rollbackClass",
  "residualCodes",
] as const satisfies readonly (keyof NpAgentRollbackChangeSetPlanOperationCanonicalV1)[];

export const npAgentRiskSummaryIncludedKeysV1 = [
  "level",
  "reasonCodes",
  "approvalMode",
  "reversible",
] as const satisfies readonly (keyof NpAgentRiskSummary)[];

function cloneBody(
  value: unknown,
  path: string,
  limits: AgentCanonicalJsonInspectionLimits,
): unknown {
  return npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, limits),
    "Invalid Agent ChangeSet canonical body",
  );
}

function remapIssues(
  issues: readonly NpAgentContractIssue[],
  sourceRoot: string,
  targetRoot: string,
): NpAgentContractIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path.startsWith(sourceRoot)
      ? `${targetRoot}${issue.path.slice(sourceRoot.length)}`
      : targetRoot,
  }));
}

function requireNested<T>(
  result: NpAgentContractResult<T>,
  sourceRoot: string,
  targetRoot: string,
): T {
  if (result.ok) return result.value;
  throw new NpAgentContractError(
    "Invalid Agent ChangeSet canonical body",
    remapIssues(result.issues, sourceRoot, targetRoot),
  );
}

function parseExplanatoryText(value: unknown, path: string, allowEmpty: boolean): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > npAgentContractLimits.changeSetExplanatoryCharacters
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be ${allowEmpty ? "0" : "1"}..${npAgentContractLimits.changeSetExplanatoryCharacters.toString()} characters`,
    );
  }
  return value;
}

function parseSortedUniqueEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  maximum: number,
  state: CanonicalBodyInspectionState,
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
  const entries = canonicalBodyArray(value, path, npCollectionContractLimits.arrayRows, state);
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

function parseSortedUniqueResidualCodes(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): string[] {
  const entries = canonicalBodyArray(value, path, npCollectionContractLimits.arrayRows, state);
  const result: string[] = [];
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      failCanonicalBody(
        "invalid-field",
        `${path}[${index.toString()}]`,
        "must be a non-empty canonical string code",
      );
    }
    const current = entry;
    const order = previous === null ? 1 : compareUnicodeCodePoints(current, previous);
    if (previous !== null && order <= 0) {
      failCanonicalBody(
        order === 0 ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by Unicode code point",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function parseRiskSummary(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRiskSummary {
  const risk = canonicalBodyRecord(
    value,
    path,
    npAgentRiskSummaryIncludedKeysV1,
    npAgentRiskSummaryIncludedKeysV1,
    state,
  );
  if (risk.approvalMode !== "human") {
    failCanonicalBody("invalid-field", `${path}.approvalMode`, "must be human");
  }
  if (typeof risk.reversible !== "boolean") {
    failCanonicalBody("invalid-field", `${path}.reversible`, "must be a boolean");
  }
  return {
    level: canonicalBodyEnum<NpAgentRiskLevel>(risk.level, `${path}.level`, RISK_LEVELS),
    reasonCodes: parseSortedUniqueEnum<NpAgentRiskReasonCode>(
      risk.reasonCodes,
      `${path}.reasonCodes`,
      RISK_REASON_CODES,
      RISK_REASON_CODES.size,
      state,
    ),
    approvalMode: "human",
    reversible: risk.reversible,
  };
}

function parseRollbackClassAndResidualCodes(
  rollbackClassValue: unknown,
  residualCodesValue: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): { rollbackClass: NpAgentChangeSetRollbackClass; residualCodes: string[] } {
  const rollbackClass = canonicalBodyEnum<NpAgentChangeSetRollbackClass>(
    rollbackClassValue,
    `${path}.rollbackClass`,
    ROLLBACK_CLASSES,
  );
  const residualCodes = parseSortedUniqueResidualCodes(
    residualCodesValue,
    `${path}.residualCodes`,
    state,
  );
  if (rollbackClass === "residual" && residualCodes.length === 0) {
    failCanonicalBody(
      "invalid-field",
      `${path}.residualCodes`,
      "must contain a visible residual code for residual rollback",
    );
  }
  return { rollbackClass, residualCodes };
}

function requireResidualRisk(
  operations: readonly { rollbackClass: NpAgentChangeSetRollbackClass }[],
  risk: NpAgentRiskSummary,
  path: string,
): void {
  if (!operations.some((operation) => operation.rollbackClass === "residual")) return;
  if (risk.reversible) {
    failCanonicalBody(
      "invalid-field",
      `${path}.reversible`,
      "must be false when any operation has residual rollback",
    );
  }
  if (!risk.reasonCodes.includes("ROLLBACK_PARTIAL")) {
    failCanonicalBody(
      "invalid-field",
      `${path}.reasonCodes`,
      "must include ROLLBACK_PARTIAL when any operation has residual rollback",
    );
  }
}

function parseProposalOperation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentChangeSetProposalOperationCanonicalV1 {
  const entry = canonicalBodyRecord(
    value,
    path,
    npAgentChangeSetProposalOperationCanonicalIncludedKeysV1,
    npAgentChangeSetProposalOperationCanonicalIncludedKeysV1,
    state,
  );
  const operation = requireNested<NpAgentChangeSetOperationInput>(
    npAnalyzeAgentChangeSetOperationInput(entry.operation),
    "agent.changeSet.operation",
    `${path}.operation`,
  );
  const canonicalResourceKey = requireNested<NpAgentChangeSetResourceKeyV1>(
    npAnalyzeAgentChangeSetResourceKey(entry.canonicalResourceKey),
    "agent.changeSet.resourceKey",
    `${path}.canonicalResourceKey`,
  );
  if (!npAgentChangeSetOperationMatchesResourceKey(operation, canonicalResourceKey)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.canonicalResourceKey`,
      "must exactly identify the operation resource",
    );
  }
  return {
    ordinal: canonicalBodyInteger(entry.ordinal, `${path}.ordinal`, 1, SIGNED_32_BIT_MAXIMUM),
    operation,
    canonicalResourceKey,
  };
}

function parseChangeSetProposalCanonical(value: unknown): NpAgentChangeSetProposalCanonicalV1 {
  const purpose = "np.agent-changeset-proposal.v1" as const;
  const path = "agent.canonical.changeSetProposal";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneBody(value, path, PROPOSAL_LIMITS),
    path,
    npAgentChangeSetProposalCanonicalIncludedKeysV1,
    npAgentChangeSetProposalCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== purpose) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${purpose}`);
  }
  const operationValues = canonicalBodyArray(
    record.operations,
    `${path}.operations`,
    npAgentContractLimits.changeSetOperations,
    state,
  );
  const operations = operationValues.map((operation, index) =>
    parseProposalOperation(operation, `${path}.operations[${index.toString()}]`, state),
  );
  let previousOrdinal = 0;
  const collections = new Set<string>();
  operations.forEach((entry, index) => {
    if (entry.ordinal <= previousOrdinal) {
      failCanonicalBody(
        entry.ordinal === previousOrdinal ? "duplicate" : "order",
        `${path}.operations[${index.toString()}].ordinal`,
        "must be sorted by unique positive ordinal",
      );
    }
    previousOrdinal = entry.ordinal;
    if (entry.operation.kind === "document" || entry.operation.kind === "media_ref") {
      collections.add(entry.operation.resource.collection);
    }
  });
  if (collections.size > npAgentContractLimits.changeSetCollections) {
    failCanonicalBody(
      "limit",
      `${path}.operations`,
      `may touch at most ${npAgentContractLimits.changeSetCollections.toString()} collections`,
    );
  }

  const result: NpAgentChangeSetProposalCanonicalV1 = {
    schemaVersion: purpose,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    changeSetId: canonicalBodyUuid(record.changeSetId, `${path}.changeSetId`),
    draftVersion: canonicalBodyInteger(
      record.draftVersion,
      `${path}.draftVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    title: parseExplanatoryText(record.title, `${path}.title`, false),
    summary:
      record.summary === null
        ? null
        : parseExplanatoryText(record.summary, `${path}.summary`, true),
    operations,
  };
  buildAgentCanonicalFoundationBytes(purpose, result);
  return result;
}

function parseInitialPlanOperation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentInitialChangeSetPlanOperationCanonicalV1 {
  const entry = canonicalBodyRecord(
    value,
    path,
    npAgentInitialChangeSetPlanOperationIncludedKeysV1,
    npAgentInitialChangeSetPlanOperationIncludedKeysV1,
    state,
  );
  const operation = requireNested<NpAgentChangeSetOperationInput>(
    npAnalyzeAgentChangeSetOperationInput(entry.operation),
    "agent.changeSet.operation",
    `${path}.operation`,
  );
  const canonicalResourceKey = requireNested<NpAgentChangeSetResourceKeyV1>(
    npAnalyzeAgentChangeSetResourceKey(entry.canonicalResourceKey),
    "agent.changeSet.resourceKey",
    `${path}.canonicalResourceKey`,
  );
  if (!npAgentChangeSetOperationMatchesResourceKey(operation, canonicalResourceKey)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.canonicalResourceKey`,
      "must exactly identify the operation resource",
    );
  }
  const beforeHash =
    entry.beforeHash === null
      ? null
      : canonicalBodySha256Digest(entry.beforeHash, `${path}.beforeHash`);
  const isReservedCreate = operation.kind === "document" && operation.operation === "create";
  if (beforeHash === null && !isReservedCreate) {
    failCanonicalBody(
      "invalid-field",
      `${path}.beforeHash`,
      "may be null only for a server-reserved create target",
    );
  }
  const rollback = parseRollbackClassAndResidualCodes(
    entry.rollbackClass,
    entry.residualCodes,
    path,
    state,
  );
  if (isReservedCreate && rollback.rollbackClass !== "residual") {
    failCanonicalBody(
      "invalid-field",
      `${path}.rollbackClass`,
      "must be residual for a document create",
    );
  }
  return {
    ordinal: canonicalBodyInteger(entry.ordinal, `${path}.ordinal`, 1, SIGNED_32_BIT_MAXIMUM),
    operation,
    canonicalResourceKey,
    beforeHash,
    proposedAfterHash: canonicalBodySha256Digest(
      entry.proposedAfterHash,
      `${path}.proposedAfterHash`,
    ),
    snapshotHash: canonicalBodySha256Digest(entry.snapshotHash, `${path}.snapshotHash`),
    ...rollback,
  };
}

function parseRollbackPlanOperation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRollbackChangeSetPlanOperationCanonicalV1 {
  const entry = canonicalBodyRecord(
    value,
    path,
    npAgentRollbackChangeSetPlanOperationIncludedKeysV1,
    npAgentRollbackChangeSetPlanOperationIncludedKeysV1,
    state,
  );
  const canonicalResourceKey = requireNested<NpAgentChangeSetResourceKeyV1>(
    npAnalyzeAgentChangeSetResourceKey(entry.canonicalResourceKey),
    "agent.changeSet.resourceKey",
    `${path}.canonicalResourceKey`,
  );
  const compensationOperation = requireNested<NpAgentChangeSetOperationInput>(
    npAnalyzeAgentChangeSetOperationInput(entry.compensationOperation),
    "agent.changeSet.operation",
    `${path}.compensationOperation`,
  );
  if (!npAgentChangeSetOperationMatchesResourceKey(compensationOperation, canonicalResourceKey)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.canonicalResourceKey`,
      "must exactly identify the compensation operation resource",
    );
  }
  return {
    ordinal: canonicalBodyInteger(entry.ordinal, `${path}.ordinal`, 1, SIGNED_32_BIT_MAXIMUM),
    originalOperationOrdinal: canonicalBodyInteger(
      entry.originalOperationOrdinal,
      `${path}.originalOperationOrdinal`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    canonicalResourceKey,
    originalSnapshotHash: canonicalBodySha256Digest(
      entry.originalSnapshotHash,
      `${path}.originalSnapshotHash`,
    ),
    expectedCurrentHash: canonicalBodySha256Digest(
      entry.expectedCurrentHash,
      `${path}.expectedCurrentHash`,
    ),
    expectedCurrentVersion: canonicalBodyAscii(
      entry.expectedCurrentVersion,
      `${path}.expectedCurrentVersion`,
      256,
    ),
    compensationOperation,
    proposedAfterHash: canonicalBodySha256Digest(
      entry.proposedAfterHash,
      `${path}.proposedAfterHash`,
    ),
    ...parseRollbackClassAndResidualCodes(entry.rollbackClass, entry.residualCodes, path, state),
  };
}

function requirePlanOperationOrder(
  operations: readonly {
    ordinal: number;
    canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  }[],
  path: string,
): void {
  let previousOrdinal = 0;
  const collections = new Set<string>();
  operations.forEach((entry, index) => {
    if (entry.ordinal <= previousOrdinal) {
      failCanonicalBody(
        entry.ordinal === previousOrdinal ? "duplicate" : "order",
        `${path}[${index.toString()}].ordinal`,
        "must be sorted by unique positive ordinal",
      );
    }
    previousOrdinal = entry.ordinal;
    if (
      entry.canonicalResourceKey.kind === "document" ||
      entry.canonicalResourceKey.kind === "media_ref"
    ) {
      collections.add(entry.canonicalResourceKey.collection);
    }
  });
  if (collections.size > npAgentContractLimits.changeSetCollections) {
    failCanonicalBody(
      "limit",
      path,
      `may touch at most ${npAgentContractLimits.changeSetCollections.toString()} collections`,
    );
  }
}

function parseInitialPlanBody(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentInitialChangeSetPlanBodyV1 {
  const body = canonicalBodyRecord(
    value,
    path,
    npAgentInitialChangeSetPlanBodyIncludedKeysV1,
    npAgentInitialChangeSetPlanBodyIncludedKeysV1,
    state,
  );
  const operationValues = canonicalBodyArray(
    body.operations,
    `${path}.operations`,
    npAgentContractLimits.changeSetOperations,
    state,
  );
  const operations = operationValues.map((operation, index) =>
    parseInitialPlanOperation(operation, `${path}.operations[${index.toString()}]`, state),
  );
  requirePlanOperationOrder(operations, `${path}.operations`);
  const risk = parseRiskSummary(body.risk, `${path}.risk`, state);
  requireResidualRisk(operations, risk, `${path}.risk`);
  return {
    draftVersion: canonicalBodyInteger(
      body.draftVersion,
      `${path}.draftVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    draftHash: canonicalBodySha256Digest(body.draftHash, `${path}.draftHash`),
    validationGeneration: canonicalBodyInteger(
      body.validationGeneration,
      `${path}.validationGeneration`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    baseFingerprint: canonicalBodySha256Digest(body.baseFingerprint, `${path}.baseFingerprint`),
    operations,
    risk,
    requiredScopes: parseSortedUniqueEnum<NpAgentScope>(
      body.requiredScopes,
      `${path}.requiredScopes`,
      SCOPES,
      SCOPES.size,
      state,
    ),
    requiredHumanCapabilities: canonicalBodyCapabilities(
      body.requiredHumanCapabilities,
      `${path}.requiredHumanCapabilities`,
      state,
    ),
    requiredHumanPredicates: parseSortedUniqueEnum<NpAgentHumanPredicate>(
      body.requiredHumanPredicates,
      `${path}.requiredHumanPredicates`,
      HUMAN_PREDICATES,
      HUMAN_PREDICATES.size,
      state,
    ),
    policyHashes: parseSortedUniqueDigests(body.policyHashes, `${path}.policyHashes`, state),
    expiresAt: canonicalBodyUtc(body.expiresAt, `${path}.expiresAt`),
    rollbackWindowSeconds: canonicalBodyInteger(
      body.rollbackWindowSeconds,
      `${path}.rollbackWindowSeconds`,
      ROLLBACK_WINDOW_MINIMUM_SECONDS,
      ROLLBACK_WINDOW_MAXIMUM_SECONDS,
    ),
  };
}

function parseRollbackPlanBody(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRollbackChangeSetPlanBodyV1 {
  const body = canonicalBodyRecord(
    value,
    path,
    npAgentRollbackChangeSetPlanBodyIncludedKeysV1,
    npAgentRollbackChangeSetPlanBodyIncludedKeysV1,
    state,
  );
  const operationValues = canonicalBodyArray(
    body.operations,
    `${path}.operations`,
    npAgentContractLimits.changeSetOperations,
    state,
  );
  const operations = operationValues.map((operation, index) =>
    parseRollbackPlanOperation(operation, `${path}.operations[${index.toString()}]`, state),
  );
  requirePlanOperationOrder(operations, `${path}.operations`);
  const originalOrdinals = new Set<number>();
  operations.forEach((operation, index) => {
    if (originalOrdinals.has(operation.originalOperationOrdinal)) {
      failCanonicalBody(
        "duplicate",
        `${path}.operations[${index.toString()}].originalOperationOrdinal`,
        "must be unique within the rollback plan",
      );
    }
    originalOrdinals.add(operation.originalOperationOrdinal);
  });
  const risk = parseRiskSummary(body.risk, `${path}.risk`, state);
  requireResidualRisk(operations, risk, `${path}.risk`);
  return {
    rollbackPlanId: canonicalBodyUuid(body.rollbackPlanId, `${path}.rollbackPlanId`),
    generation: canonicalBodyInteger(
      body.generation,
      `${path}.generation`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    compensatesExecutionId: canonicalBodyUuid(
      body.compensatesExecutionId,
      `${path}.compensatesExecutionId`,
    ),
    originalPlanHash: canonicalBodySha256Digest(body.originalPlanHash, `${path}.originalPlanHash`),
    appliedResultDigest: canonicalBodySha256Digest(
      body.appliedResultDigest,
      `${path}.appliedResultDigest`,
    ),
    baseFingerprint: canonicalBodySha256Digest(body.baseFingerprint, `${path}.baseFingerprint`),
    operations,
    risk,
    requiredScopes: parseSortedUniqueEnum<NpAgentScope>(
      body.requiredScopes,
      `${path}.requiredScopes`,
      SCOPES,
      SCOPES.size,
      state,
    ),
    requiredHumanCapabilities: canonicalBodyCapabilities(
      body.requiredHumanCapabilities,
      `${path}.requiredHumanCapabilities`,
      state,
    ),
    requiredHumanPredicates: parseSortedUniqueEnum<NpAgentHumanPredicate>(
      body.requiredHumanPredicates,
      `${path}.requiredHumanPredicates`,
      HUMAN_PREDICATES,
      HUMAN_PREDICATES.size,
      state,
    ),
    policyHashes: parseSortedUniqueDigests(body.policyHashes, `${path}.policyHashes`, state),
    expiresAt: canonicalBodyUtc(body.expiresAt, `${path}.expiresAt`),
  };
}

function parseChangeSetPlanCanonical(value: unknown): NpAgentChangeSetPlanCanonicalV1 {
  const purpose = "np.agent-changeset-plan.v1" as const;
  const path = "agent.canonical.changeSetPlan";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneBody(value, path, PLAN_LIMITS),
    path,
    npAgentChangeSetPlanCanonicalIncludedKeysV1,
    npAgentChangeSetPlanCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== purpose) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${purpose}`);
  }
  const planKind = canonicalBodyEnum<NpAgentChangeSetPlanKind>(
    record.planKind,
    `${path}.planKind`,
    PLAN_KINDS,
  );
  const common = {
    schemaVersion: purpose,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    changeSetId: canonicalBodyUuid(record.changeSetId, `${path}.changeSetId`),
  };
  const result: NpAgentChangeSetPlanCanonicalV1 =
    planKind === "changeset"
      ? {
          ...common,
          planKind,
          body: parseInitialPlanBody(record.body, `${path}.body`, state),
        }
      : {
          ...common,
          planKind,
          body: parseRollbackPlanBody(record.body, `${path}.body`, state),
        };
  buildAgentCanonicalFoundationBytes(purpose, result);
  return result;
}

function parseSnapshotJsonValue(value: unknown, path: string): NpAgentJsonValue {
  const result = npAnalyzeCollectionJsonValue(value, path);
  if (!result.ok) {
    throw new NpAgentContractError(
      "Invalid Agent ChangeSet snapshot value",
      result.issues.map((issue) => ({
        code:
          issue.code === "shape"
            ? "shape"
            : issue.code === "max-items"
              ? "limit"
              : issue.code === "duplicate"
                ? "duplicate"
                : issue.code === "unknown-field"
                  ? "unknown-field"
                  : "invalid-field",
        path: issue.path,
        message: issue.message,
      })),
    );
  }
  return result.value;
}

function parseSnapshotBase(value: unknown, path: string): NpAgentVersionBaseV1 {
  return requireNested(npAnalyzeAgentVersionBase(value), "agent.changeSet.versionBase", path);
}

function parseChangeSetSnapshotCanonical(value: unknown): NpAgentChangeSetSnapshotCanonicalV1 {
  const purpose = "np.agent-changeset-snapshot.v1" as const;
  const path = "agent.canonical.changeSetSnapshot";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneBody(value, path, SNAPSHOT_LIMITS),
    path,
    npAgentChangeSetSnapshotCanonicalIncludedKeysV1,
    npAgentChangeSetSnapshotCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== purpose) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${purpose}`);
  }
  const presence = canonicalBodyEnum<NpAgentChangeSetSnapshotPresence>(
    record.presence,
    `${path}.presence`,
    SNAPSHOT_PRESENCES,
  );
  let base: NpAgentVersionBaseV1 | null;
  let snapshotValue: NpAgentJsonValue | null;
  if (presence === "absent") {
    if (record.base !== null || record.value !== null) {
      failCanonicalBody(
        "invalid-field",
        record.base !== null ? `${path}.base` : `${path}.value`,
        "must be null when the resource is absent",
      );
    }
    base = null;
    snapshotValue = null;
  } else {
    if (record.base === null || record.value === null) {
      failCanonicalBody(
        "invalid-field",
        record.base === null ? `${path}.base` : `${path}.value`,
        "must be non-null when the resource is present",
      );
    }
    base = parseSnapshotBase(record.base, `${path}.base`);
    snapshotValue = parseSnapshotJsonValue(record.value, `${path}.value`);
  }

  const result: NpAgentChangeSetSnapshotCanonicalV1 = {
    schemaVersion: purpose,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    changeSetId: canonicalBodyUuid(record.changeSetId, `${path}.changeSetId`),
    operationOrdinal: canonicalBodyInteger(
      record.operationOrdinal,
      `${path}.operationOrdinal`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    canonicalResourceKey: requireNested(
      npAnalyzeAgentChangeSetResourceKey(record.canonicalResourceKey),
      "agent.changeSet.resourceKey",
      `${path}.canonicalResourceKey`,
    ),
    presence,
    base,
    value: snapshotValue,
  };
  buildAgentCanonicalFoundationBytes(purpose, result);
  return result;
}

export function npAnalyzeAgentChangeSetProposalCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetProposalCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.changeSetProposal", () =>
    parseChangeSetProposalCanonical(value),
  );
}

export function npRequireAgentChangeSetProposalCanonical(
  value: unknown,
): NpAgentChangeSetProposalCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetProposalCanonical(value),
    "Invalid Agent ChangeSet proposal canonical body",
  );
}

export function npBuildAgentChangeSetProposalCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-changeset-proposal.v1",
  NpAgentChangeSetProposalCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    "np.agent-changeset-proposal.v1",
    npRequireAgentChangeSetProposalCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-changeset-proposal.v1",
    NpAgentChangeSetProposalCanonicalV1
  >;
}

export async function npDigestAgentChangeSetProposalCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentChangeSetProposalCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export function npAnalyzeAgentChangeSetPlanCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetPlanCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.changeSetPlan", () =>
    parseChangeSetPlanCanonical(value),
  );
}

export function npRequireAgentChangeSetPlanCanonical(
  value: unknown,
): NpAgentChangeSetPlanCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetPlanCanonical(value),
    "Invalid Agent ChangeSet plan canonical body",
  );
}

export function npBuildAgentChangeSetPlanCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-changeset-plan.v1", NpAgentChangeSetPlanCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    "np.agent-changeset-plan.v1",
    npRequireAgentChangeSetPlanCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-changeset-plan.v1",
    NpAgentChangeSetPlanCanonicalV1
  >;
}

export async function npDigestAgentChangeSetPlanCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentChangeSetPlanCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export function npAnalyzeAgentChangeSetSnapshotCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetSnapshotCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.changeSetSnapshot", () =>
    parseChangeSetSnapshotCanonical(value),
  );
}

export function npRequireAgentChangeSetSnapshotCanonical(
  value: unknown,
): NpAgentChangeSetSnapshotCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetSnapshotCanonical(value),
    "Invalid Agent ChangeSet snapshot canonical body",
  );
}

export function npBuildAgentChangeSetSnapshotCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-changeset-snapshot.v1",
  NpAgentChangeSetSnapshotCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    "np.agent-changeset-snapshot.v1",
    npRequireAgentChangeSetSnapshotCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-changeset-snapshot.v1",
    NpAgentChangeSetSnapshotCanonicalV1
  >;
}

export async function npDigestAgentChangeSetSnapshotCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentChangeSetSnapshotCanonicalBytes(value).domainSeparatedUtf8,
  );
}
