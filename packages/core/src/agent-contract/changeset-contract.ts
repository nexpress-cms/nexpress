import {
  npAnalyzeCollectionJsonValue,
  npCollectionContractLimits,
} from "../collection-contract/contract.js";
import {
  npAnalyzeNavigationItems,
  npAnalyzeNavigationLocation,
  npNavigationCollectionSlugPattern,
  npNavigationLimits,
} from "../navigation/contract.js";
import type { NpNavigationItems } from "../navigation/types.js";
import { npAnalyzeSettingValue, npDynamicSettingOwnerPattern } from "../settings/contract.js";
import { npAnalyzeThemeTokensOverlay } from "../theme/contract.js";
import type { NpThemeTokensOverlay } from "../theme/types.js";
import {
  NpAgentContractError,
  npAgentContractLimits,
  npRequireAgentContractResult,
} from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { analyzeAgentCanonicalJsonValueWithLimits } from "./canonical-foundation.js";
import {
  npAgentChangeSetResourceKinds,
  npAgentDocumentChangeSetOperations,
  npAgentMutableSettingKeys,
  type NpAgentChangeSetOperationInput,
  type NpAgentChangeSetResourceKeyV1,
  type NpAgentChangeSetResourceKind,
  type NpAgentContractIssue,
  type NpAgentContractResult,
  type NpAgentDocumentChangeSetOperation,
  type NpAgentJsonObject,
  type NpAgentJsonValue,
  type NpAgentMutableSettingKey,
  type NpAgentVersionBaseV1,
} from "./types.js";

const RESOURCE_KINDS = new Set<string>(npAgentChangeSetResourceKinds);
const DOCUMENT_OPERATIONS = new Set<string>(npAgentDocumentChangeSetOperations);
const MUTABLE_SETTING_KEYS = new Set<string>(npAgentMutableSettingKeys);
const TARGET_STATUSES = new Set<string>(["draft", "published"]);
const COLLECTION_SLUG_PATTERN = new RegExp(npNavigationCollectionSlugPattern, "u");
const THEME_ID_PATTERN = new RegExp(npDynamicSettingOwnerPattern, "u");
const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/u;

const OPERATION_LIMITS = {
  maximumDepth: npCollectionContractLimits.jsonDepth,
  maximumNodes: npCollectionContractLimits.jsonNodes,
  maximumArrayItems: npCollectionContractLimits.arrayRows,
  maximumObjectProperties: npCollectionContractLimits.jsonKeys,
  maximumStringCharacters: npCollectionContractLimits.stringLength,
  maximumCanonicalBytes: 4 * 1024 * 1024,
} as const;

const RESOURCE_KEY_LIMITS = {
  maximumDepth: 8,
  maximumNodes: 32,
  maximumArrayItems: 0,
  maximumObjectProperties: 5,
  maximumStringCharacters: npAgentContractLimits.changeSetExplanatoryCharacters,
  maximumCanonicalBytes: npAgentContractLimits.changeSetSnapshotBytes,
} as const;

export const npAgentChangeSetOperationIncludedKeysV1 = [
  "clientOperationId",
  "reason",
  "kind",
  "operation",
  "resource",
  "base",
  "input",
] as const satisfies readonly (keyof NpAgentChangeSetOperationInput)[];

export const npAgentVersionBaseIncludedKeysV1 = [
  "version",
  "digest",
] as const satisfies readonly (keyof NpAgentVersionBaseV1)[];

export const npAgentChangeSetOperationResourceIncludedKeysV1 = {
  document: ["collection", "documentId"],
  navigation: ["location"],
  theme_tokens: ["themeId"],
  setting: ["key"],
  media_ref: ["mediaId", "collection", "documentId", "field"],
} as const satisfies Record<NpAgentChangeSetResourceKind, readonly string[]>;

export const npAgentChangeSetOperationInputIncludedKeysV1 = {
  "document.create": ["document", "targetStatus"],
  "document.update": ["patch", "targetStatus"],
  "document.publish": [],
  "document.archive": [],
  "document.schedule": ["publishAt"],
  "navigation.replace": ["items"],
  "theme_tokens.replace": ["tokens"],
  "setting.replace": ["value"],
  "setting.remove": [],
  "media_ref.attach": [],
  "media_ref.detach": [],
} as const;

export const npAgentChangeSetResourceKeyIncludedKeysV1 = {
  document: ["kind", "collection", "documentId"],
  navigation: ["kind", "location"],
  theme_tokens: ["kind", "themeId"],
  setting: ["kind", "key"],
  media_ref: ["kind", "mediaId", "collection", "documentId", "field"],
} as const satisfies Record<NpAgentChangeSetResourceKind, readonly string[]>;

function mapOwnerIssueCode(code: string | undefined): NpAgentContractIssue["code"] {
  switch (code) {
    case "shape":
      return "shape";
    case "duplicate":
    case "duplicate-id":
      return "duplicate";
    case "max-depth":
    case "max-items":
      return "limit";
    case "unknown-field":
    case "unknown-key":
      return "unknown-field";
    default:
      return "invalid-field";
  }
}

function remapOwnerPath(path: string, sourceRoot: string, targetRoot: string): string {
  return path.startsWith(sourceRoot) ? `${targetRoot}${path.slice(sourceRoot.length)}` : targetRoot;
}

function failOwnerIssues(
  issues: readonly { code?: string; path?: string; message: string }[],
  sourceRoot: string,
  targetRoot: string,
): never {
  throw new NpAgentContractError(
    "Invalid Agent ChangeSet contract value",
    issues.map((issue) => ({
      code: mapOwnerIssueCode(issue.code),
      path: remapOwnerPath(issue.path ?? sourceRoot, sourceRoot, targetRoot),
      message: issue.message,
    })),
  );
}

function cloneOperationInput(value: unknown, path: string): unknown {
  return npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, OPERATION_LIMITS),
    "Invalid Agent ChangeSet operation",
  );
}

function cloneResourceKeyInput(value: unknown, path: string): unknown {
  return npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, RESOURCE_KEY_LIMITS),
    "Invalid Agent ChangeSet resource key",
  );
}

function parseCollectionSlug(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npNavigationLimits.collectionSlugLength ||
    !COLLECTION_SLUG_PATTERN.test(value)
  ) {
    failCanonicalBody("invalid-field", path, "must be a canonical collection slug");
  }
  return value;
}

function parseThemeId(value: unknown, path: string): string {
  if (typeof value !== "string" || !THEME_ID_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical registered-theme id");
  }
  return value;
}

function parseFieldName(value: unknown, path: string): string {
  if (typeof value !== "string" || !FIELD_NAME_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical collection field name");
  }
  return value;
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

function parseReason(value: unknown, path: string): string | null {
  return value === null ? null : parseExplanatoryText(value, path, true);
}

function parseAgentVersionBase(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentVersionBaseV1 {
  const base = canonicalBodyRecord(
    value,
    path,
    npAgentVersionBaseIncludedKeysV1,
    npAgentVersionBaseIncludedKeysV1,
    state,
  );
  return {
    version: canonicalBodyAscii(base.version, `${path}.version`, 256),
    digest: canonicalBodySha256Digest(base.digest, `${path}.digest`),
  };
}

function parseJsonValue(value: unknown, path: string): NpAgentJsonValue {
  const result = npAnalyzeCollectionJsonValue(value, path);
  if (!result.ok) {
    failOwnerIssues(result.issues, path, path);
  }
  return result.value;
}

function parseJsonObject(value: unknown, path: string): NpAgentJsonObject {
  const result = parseJsonValue(value, path);
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    failCanonicalBody("shape", path, "must be an object-root canonical JSON value");
  }
  return result;
}

function parseEmptyInput(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): Record<string, never> {
  canonicalBodyRecord(value, path, [], [], state);
  return {};
}

function parseDocumentResource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
  create: true,
): { collection: string; documentId: null };
function parseDocumentResource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
  create: false,
): { collection: string; documentId: string };
function parseDocumentResource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
  create: boolean,
): { collection: string; documentId: string | null } {
  const resource = canonicalBodyRecord(
    value,
    path,
    npAgentChangeSetOperationResourceIncludedKeysV1.document,
    npAgentChangeSetOperationResourceIncludedKeysV1.document,
    state,
  );
  const documentId = create
    ? resource.documentId === null
      ? null
      : failCanonicalBody("invalid-field", `${path}.documentId`, "must be null for create")
    : canonicalBodyUuid(resource.documentId, `${path}.documentId`);
  return {
    collection: parseCollectionSlug(resource.collection, `${path}.collection`),
    documentId,
  };
}

function parseNavigationResource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): { location: string } {
  const resource = canonicalBodyRecord(
    value,
    path,
    npAgentChangeSetOperationResourceIncludedKeysV1.navigation,
    npAgentChangeSetOperationResourceIncludedKeysV1.navigation,
    state,
  );
  const issues = npAnalyzeNavigationLocation(resource.location);
  if (issues.length > 0) {
    failOwnerIssues(issues, "navigation.location", `${path}.location`);
  }
  return { location: resource.location as string };
}

function parseThemeResource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): { themeId: string } {
  const resource = canonicalBodyRecord(
    value,
    path,
    npAgentChangeSetOperationResourceIncludedKeysV1.theme_tokens,
    npAgentChangeSetOperationResourceIncludedKeysV1.theme_tokens,
    state,
  );
  return { themeId: parseThemeId(resource.themeId, `${path}.themeId`) };
}

function parseSettingResource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): { key: NpAgentMutableSettingKey } {
  const resource = canonicalBodyRecord(
    value,
    path,
    npAgentChangeSetOperationResourceIncludedKeysV1.setting,
    npAgentChangeSetOperationResourceIncludedKeysV1.setting,
    state,
  );
  return {
    key: canonicalBodyEnum<NpAgentMutableSettingKey>(
      resource.key,
      `${path}.key`,
      MUTABLE_SETTING_KEYS,
    ),
  };
}

function parseMediaResource(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): { mediaId: string; collection: string; documentId: string; field: string } {
  const resource = canonicalBodyRecord(
    value,
    path,
    npAgentChangeSetOperationResourceIncludedKeysV1.media_ref,
    npAgentChangeSetOperationResourceIncludedKeysV1.media_ref,
    state,
  );
  return {
    mediaId: canonicalBodyUuid(resource.mediaId, `${path}.mediaId`),
    collection: parseCollectionSlug(resource.collection, `${path}.collection`),
    documentId: canonicalBodyUuid(resource.documentId, `${path}.documentId`),
    field: parseFieldName(resource.field, `${path}.field`),
  };
}

function requireBase(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentVersionBaseV1 {
  if (value === null) {
    failCanonicalBody("invalid-field", path, "must contain the exact resource base");
  }
  return parseAgentVersionBase(value, path, state);
}

function parseDocumentOperation(
  operation: NpAgentDocumentChangeSetOperation,
  record: Record<string, unknown>,
  path: string,
  state: CanonicalBodyInspectionState,
  common: { clientOperationId: string; reason: string | null },
): NpAgentChangeSetOperationInput {
  if (operation === "create") {
    if (record.base !== null) {
      failCanonicalBody("invalid-field", `${path}.base`, "must be null for document create");
    }
    const input = canonicalBodyRecord(
      record.input,
      `${path}.input`,
      npAgentChangeSetOperationInputIncludedKeysV1["document.create"],
      npAgentChangeSetOperationInputIncludedKeysV1["document.create"],
      state,
    );
    return {
      ...common,
      kind: "document",
      operation,
      resource: parseDocumentResource(record.resource, `${path}.resource`, state, true),
      base: null,
      input: {
        document: parseJsonObject(input.document, `${path}.input.document`),
        targetStatus: canonicalBodyEnum<"draft" | "published">(
          input.targetStatus,
          `${path}.input.targetStatus`,
          TARGET_STATUSES,
        ),
      },
    };
  }

  const resource = parseDocumentResource(record.resource, `${path}.resource`, state, false);
  const base = requireBase(record.base, `${path}.base`, state);
  if (operation === "update") {
    const input = canonicalBodyRecord(
      record.input,
      `${path}.input`,
      npAgentChangeSetOperationInputIncludedKeysV1["document.update"],
      npAgentChangeSetOperationInputIncludedKeysV1["document.update"],
      state,
    );
    return {
      ...common,
      kind: "document",
      operation,
      resource,
      base,
      input: {
        patch: parseJsonObject(input.patch, `${path}.input.patch`),
        targetStatus:
          input.targetStatus === null
            ? null
            : canonicalBodyEnum<"draft" | "published">(
                input.targetStatus,
                `${path}.input.targetStatus`,
                TARGET_STATUSES,
              ),
      },
    };
  }
  if (operation === "schedule") {
    const input = canonicalBodyRecord(
      record.input,
      `${path}.input`,
      npAgentChangeSetOperationInputIncludedKeysV1["document.schedule"],
      npAgentChangeSetOperationInputIncludedKeysV1["document.schedule"],
      state,
    );
    return {
      ...common,
      kind: "document",
      operation,
      resource,
      base,
      input: { publishAt: canonicalBodyUtc(input.publishAt, `${path}.input.publishAt`) },
    };
  }
  return {
    ...common,
    kind: "document",
    operation,
    resource,
    base,
    input: parseEmptyInput(record.input, `${path}.input`, state),
  };
}

function parseChangeSetOperationInput(
  value: unknown,
  path: string,
): NpAgentChangeSetOperationInput {
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneOperationInput(value, path),
    path,
    npAgentChangeSetOperationIncludedKeysV1,
    npAgentChangeSetOperationIncludedKeysV1,
    state,
  );
  const kind = canonicalBodyEnum<NpAgentChangeSetResourceKind>(
    record.kind,
    `${path}.kind`,
    RESOURCE_KINDS,
  );
  const common = {
    clientOperationId: canonicalBodyAscii(
      record.clientOperationId,
      `${path}.clientOperationId`,
      npAgentContractLimits.identifierCharacters,
    ),
    reason: parseReason(record.reason, `${path}.reason`),
  };

  if (kind === "document") {
    return parseDocumentOperation(
      canonicalBodyEnum<NpAgentDocumentChangeSetOperation>(
        record.operation,
        `${path}.operation`,
        DOCUMENT_OPERATIONS,
      ),
      record,
      path,
      state,
      common,
    );
  }

  if (kind === "navigation") {
    if (record.operation !== "replace") {
      failCanonicalBody("invalid-field", `${path}.operation`, "must be replace for navigation");
    }
    const input = canonicalBodyRecord(
      record.input,
      `${path}.input`,
      npAgentChangeSetOperationInputIncludedKeysV1["navigation.replace"],
      npAgentChangeSetOperationInputIncludedKeysV1["navigation.replace"],
      state,
    );
    const issues = npAnalyzeNavigationItems(input.items);
    if (issues.length > 0) {
      failOwnerIssues(issues, "navigation.items", `${path}.input.items`);
    }
    return {
      ...common,
      kind,
      operation: "replace",
      resource: parseNavigationResource(record.resource, `${path}.resource`, state),
      base: requireBase(record.base, `${path}.base`, state),
      input: { items: input.items as NpNavigationItems },
    };
  }

  if (kind === "theme_tokens") {
    if (record.operation !== "replace") {
      failCanonicalBody("invalid-field", `${path}.operation`, "must be replace for theme tokens");
    }
    const input = canonicalBodyRecord(
      record.input,
      `${path}.input`,
      npAgentChangeSetOperationInputIncludedKeysV1["theme_tokens.replace"],
      npAgentChangeSetOperationInputIncludedKeysV1["theme_tokens.replace"],
      state,
    );
    const issues = npAnalyzeThemeTokensOverlay(input.tokens);
    if (issues.length > 0) {
      failOwnerIssues(issues, "theme", `${path}.input.tokens`);
    }
    return {
      ...common,
      kind,
      operation: "replace",
      resource: parseThemeResource(record.resource, `${path}.resource`, state),
      base: requireBase(record.base, `${path}.base`, state),
      input: { tokens: input.tokens as NpThemeTokensOverlay },
    };
  }

  if (kind === "setting") {
    const resource = parseSettingResource(record.resource, `${path}.resource`, state);
    if (record.operation === "replace") {
      const input = canonicalBodyRecord(
        record.input,
        `${path}.input`,
        npAgentChangeSetOperationInputIncludedKeysV1["setting.replace"],
        npAgentChangeSetOperationInputIncludedKeysV1["setting.replace"],
        state,
      );
      const issues = npAnalyzeSettingValue(resource.key, input.value);
      if (issues.length > 0) {
        failOwnerIssues(issues, `settings.${resource.key}`, `${path}.input.value`);
      }
      return {
        ...common,
        kind,
        operation: "replace",
        resource,
        base:
          record.base === null ? null : parseAgentVersionBase(record.base, `${path}.base`, state),
        input: { value: parseJsonValue(input.value, `${path}.input.value`) },
      };
    }
    if (record.operation !== "remove") {
      failCanonicalBody(
        "invalid-field",
        `${path}.operation`,
        "must be replace or remove for setting",
      );
    }
    return {
      ...common,
      kind,
      operation: "remove",
      resource,
      base: requireBase(record.base, `${path}.base`, state),
      input: parseEmptyInput(record.input, `${path}.input`, state),
    };
  }

  if (record.operation !== "attach" && record.operation !== "detach") {
    failCanonicalBody(
      "invalid-field",
      `${path}.operation`,
      "must be attach or detach for media reference",
    );
  }
  return {
    ...common,
    kind,
    operation: record.operation,
    resource: parseMediaResource(record.resource, `${path}.resource`, state),
    base: requireBase(record.base, `${path}.base`, state),
    input: parseEmptyInput(record.input, `${path}.input`, state),
  };
}

function parseChangeSetResourceKey(value: unknown, path: string): NpAgentChangeSetResourceKeyV1 {
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const cloned = cloneResourceKeyInput(value, path);
  if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) {
    failCanonicalBody("shape", path, "must be an ordinary resource-key object");
  }
  const kindValue = (cloned as Record<string, unknown>).kind;
  const kind = canonicalBodyEnum<NpAgentChangeSetResourceKind>(
    kindValue,
    `${path}.kind`,
    RESOURCE_KINDS,
  );
  const record = canonicalBodyRecord(
    cloned,
    path,
    npAgentChangeSetResourceKeyIncludedKeysV1[kind],
    npAgentChangeSetResourceKeyIncludedKeysV1[kind],
    state,
  );
  switch (kind) {
    case "document":
      return {
        kind,
        collection: parseCollectionSlug(record.collection, `${path}.collection`),
        documentId: canonicalBodyUuid(record.documentId, `${path}.documentId`),
      };
    case "navigation": {
      const issues = npAnalyzeNavigationLocation(record.location);
      if (issues.length > 0) {
        failOwnerIssues(issues, "navigation.location", `${path}.location`);
      }
      return { kind, location: record.location as string };
    }
    case "theme_tokens":
      return { kind, themeId: parseThemeId(record.themeId, `${path}.themeId`) };
    case "setting":
      return {
        kind,
        key: canonicalBodyEnum<NpAgentMutableSettingKey>(
          record.key,
          `${path}.key`,
          MUTABLE_SETTING_KEYS,
        ),
      };
    case "media_ref":
      return {
        kind,
        mediaId: canonicalBodyUuid(record.mediaId, `${path}.mediaId`),
        collection: parseCollectionSlug(record.collection, `${path}.collection`),
        documentId: canonicalBodyUuid(record.documentId, `${path}.documentId`),
        field: parseFieldName(record.field, `${path}.field`),
      };
  }
}

export function npAnalyzeAgentChangeSetOperationInput(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetOperationInput> {
  return analyzeCanonicalBody("agent.changeSet.operation", () =>
    parseChangeSetOperationInput(value, "agent.changeSet.operation"),
  );
}

export function npAnalyzeAgentVersionBase(
  value: unknown,
): NpAgentContractResult<NpAgentVersionBaseV1> {
  return analyzeCanonicalBody("agent.changeSet.versionBase", () => {
    const path = "agent.changeSet.versionBase";
    const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
    return parseAgentVersionBase(cloneResourceKeyInput(value, path), path, state);
  });
}

export function npRequireAgentVersionBase(value: unknown): NpAgentVersionBaseV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentVersionBase(value),
    "Invalid Agent ChangeSet resource base",
  );
}

export function npRequireAgentChangeSetOperationInput(
  value: unknown,
): NpAgentChangeSetOperationInput {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetOperationInput(value),
    "Invalid Agent ChangeSet operation",
  );
}

export function npAnalyzeAgentChangeSetResourceKey(
  value: unknown,
): NpAgentContractResult<NpAgentChangeSetResourceKeyV1> {
  return analyzeCanonicalBody("agent.changeSet.resourceKey", () =>
    parseChangeSetResourceKey(value, "agent.changeSet.resourceKey"),
  );
}

export function npRequireAgentChangeSetResourceKey(value: unknown): NpAgentChangeSetResourceKeyV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetResourceKey(value),
    "Invalid Agent ChangeSet resource key",
  );
}

export function npAgentChangeSetOperationMatchesResourceKey(
  operation: NpAgentChangeSetOperationInput,
  resourceKey: NpAgentChangeSetResourceKeyV1,
): boolean {
  if (operation.kind !== resourceKey.kind) return false;
  switch (operation.kind) {
    case "document":
      return (
        resourceKey.kind === "document" &&
        operation.resource.collection === resourceKey.collection &&
        (operation.operation === "create" ||
          operation.resource.documentId === resourceKey.documentId)
      );
    case "navigation":
      return (
        resourceKey.kind === "navigation" && operation.resource.location === resourceKey.location
      );
    case "theme_tokens":
      return (
        resourceKey.kind === "theme_tokens" && operation.resource.themeId === resourceKey.themeId
      );
    case "setting":
      return resourceKey.kind === "setting" && operation.resource.key === resourceKey.key;
    case "media_ref":
      return (
        resourceKey.kind === "media_ref" &&
        operation.resource.mediaId === resourceKey.mediaId &&
        operation.resource.collection === resourceKey.collection &&
        operation.resource.documentId === resourceKey.documentId &&
        operation.resource.field === resourceKey.field
      );
  }
}
