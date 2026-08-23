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
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySiteId,
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
  npAgentChangeSetSnapshotPresences,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentChangeSetOperationInput,
  type NpAgentChangeSetProposalCanonicalV1,
  type NpAgentChangeSetProposalOperationCanonicalV1,
  type NpAgentChangeSetResourceKeyV1,
  type NpAgentChangeSetSnapshotCanonicalV1,
  type NpAgentChangeSetSnapshotPresence,
  type NpAgentContractIssue,
  type NpAgentContractResult,
  type NpAgentJsonValue,
  type NpAgentVersionBaseV1,
} from "./types.js";

const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const SNAPSHOT_PRESENCES = new Set<string>(npAgentChangeSetSnapshotPresences);

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
