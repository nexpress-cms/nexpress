import {
  npNavigationLimits,
  npNavigationItemIdPattern,
  npNavigationCollectionSlugPattern,
  npNavigationLocationPattern,
} from "../navigation/contract.js";
import { npDynamicSettingOwnerPattern } from "../settings/contract.js";
import { npSiteIdPattern } from "../sites/id-contract.js";
import type { NpCapability } from "../auth/capabilities.js";
import { npCollectionContractLimits } from "../collection-contract/contract.js";
import {
  npAgentContractLimits,
  npRequireAgentContractResult,
  npAnalyzeAgentJsonSchema,
} from "./contract.js";

import { npThemeTokenKeys } from "../theme/contract.js";
import {
  npAgentChangeSetLimits,
  npAgentChangeSetStates,
  npAgentRollbackPlanStates,
  npAgentValidationIssueCodes,
} from "./changeset-wire-contract.js";
import {
  npAgentHumanPredicates,
  npAgentMutableSettingKeys,
  npAgentRiskLevels,
  npAgentRiskReasonCodes,
  type NpAgentJsonObject,
  type NpAgentJsonValue,
  type NpAgentJsonSchema,
} from "./types.js";

const npCapabilities = Object.keys({
  "site.access": true,
  "content.publish": true,
  "content.author": true,
  "community.moderate": true,
  "admin.manage": true,
} satisfies Record<NpCapability, true>);

// These discovery schemas project the existing exact wires. Their analyzers remain
// authoritative for cross-field, current-resource and canonical-byte invariants.
export const npAgentSchemaObjectV1 = (
  properties: NpAgentJsonObject,
  required = Object.keys(properties),
): NpAgentJsonObject & { type: "object"; additionalProperties: false } => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const obj = npAgentSchemaObjectV1;
const str = (maxLength = 4096) => ({ type: "string", maxLength });
const en = (values: readonly string[]) => ({
  type: "string",
  maxLength: Math.max(...values.map((value) => value.length)),
  enum: [...values],
});
const nil = { type: "null" };
const nullable = (schema: NpAgentJsonValue) => ({ anyOf: [schema, nil] });
const arr = (items: NpAgentJsonValue, maxItems: number) => ({ type: "array", items, maxItems });
const uuid = { ...str(36), format: "uuid" };
const utc = { ...str(24), format: "date-time" };
const digest = { ...str(54), pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$" };
const positive = { type: "integer", minimum: 1, maximum: 2147483647 };
const natural = { type: "integer", minimum: 0, maximum: 2147483647 };
const boolean = { type: "boolean" };
const base = obj({ version: str(256), digest });
const resource = {
  document: obj({
    collection: {
      ...str(npNavigationLimits.collectionSlugLength),
      pattern: npNavigationCollectionSlugPattern,
    },
    documentId: uuid,
  }),
  navigation: obj({
    location: { ...str(npNavigationLimits.locationLength), pattern: npNavigationLocationPattern },
  }),
  theme_tokens: obj({ themeId: { ...str(63), pattern: npDynamicSettingOwnerPattern } }),
  setting: obj({ key: en(npAgentMutableSettingKeys) }),
  media_ref: obj({
    mediaId: uuid,
    collection: {
      ...str(npNavigationLimits.collectionSlugLength),
      pattern: npNavigationCollectionSlugPattern,
    },
    documentId: uuid,
    field: { ...str(npCollectionContractLimits.stringLength), pattern: "^[a-z][A-Za-z0-9]*$" },
  }),
};
const json = { $ref: "#/$defs/json" };
const jsonObject = {
  type: "object",
  maxProperties: npCollectionContractLimits.jsonKeys,
  additionalProperties: false,
  patternProperties: { ".*": json },
};
const defs: NpAgentJsonObject = {
  json: {
    anyOf: [
      nil,
      boolean,
      { type: "number" },
      str(npCollectionContractLimits.stringLength),
      arr(json, npCollectionContractLimits.arrayRows),
      jsonObject,
    ],
  },
  nav: {
    oneOf: [
      obj(
        {
          type: { const: "link" },
          id: { ...str(npNavigationLimits.itemIdLength), pattern: npNavigationItemIdPattern },
          label: { ...str(npNavigationLimits.labelLength), minLength: 1 },
          url: { ...str(npNavigationLimits.urlLength), minLength: 1 },
          children: arr({ $ref: "#/$defs/navChild" }, npNavigationLimits.maxItems),
        },
        ["type", "id", "label", "url"],
      ),
      obj(
        {
          type: { const: "collection" },
          id: { ...str(npNavigationLimits.itemIdLength), pattern: npNavigationItemIdPattern },
          label: { ...str(npNavigationLimits.labelLength), minLength: 1 },
          collection: {
            ...str(npNavigationLimits.collectionSlugLength),
            pattern: npNavigationCollectionSlugPattern,
          },
          children: arr({ $ref: "#/$defs/navChild" }, npNavigationLimits.maxItems),
        },
        ["type", "id", "label", "collection"],
      ),
      obj(
        {
          type: { const: "page" },
          id: { ...str(npNavigationLimits.itemIdLength), pattern: npNavigationItemIdPattern },
          label: { ...str(npNavigationLimits.labelLength), minLength: 1 },
          pageId: { ...str(npNavigationLimits.itemIdLength), pattern: npNavigationItemIdPattern },
          collectionSlug: {
            ...str(npNavigationLimits.collectionSlugLength),
            pattern: npNavigationCollectionSlugPattern,
          },
          children: arr({ $ref: "#/$defs/navChild" }, npNavigationLimits.maxItems),
        },
        ["type", "id", "label", "pageId"],
      ),
    ],
  },
};
const navigationBranches = (defs.nav as NpAgentJsonObject).oneOf as NpAgentJsonObject[];
defs.navChild = {
  oneOf: navigationBranches.map((branch) => ({
    ...branch,
    properties: {
      ...(branch.properties as NpAgentJsonObject),
      children: arr({ $ref: "#/$defs/navChild" }, 0),
    },
  })),
};
const tokens = obj(
  Object.fromEntries(
    Object.entries(npThemeTokenKeys).map(([section, keys]) => [
      section,
      obj(Object.fromEntries(keys.map((key) => [key, str(200)])), []),
    ]),
  ),
  [],
);
const common = {
  clientOperationId: str(npAgentContractLimits.identifierCharacters),
  reason: nullable(str(npAgentChangeSetLimits.explanatoryCharacters)),
};
const op = (
  kind: keyof typeof resource,
  operation: string,
  input: NpAgentJsonValue,
  target: NpAgentJsonValue = resource[kind],
  version: NpAgentJsonValue = base,
) =>
  obj({
    ...common,
    kind: { const: kind },
    operation: { const: operation },
    resource: target,
    base: version,
    input,
  });
const operation = {
  oneOf: [
    op(
      "document",
      "create",
      obj({ document: jsonObject, targetStatus: en(["draft", "published"]) }),
      obj({
        collection: {
          ...str(npNavigationLimits.collectionSlugLength),
          pattern: npNavigationCollectionSlugPattern,
        },
        documentId: nil,
      }),
      nil,
    ),
    op(
      "document",
      "update",
      obj({ patch: jsonObject, targetStatus: nullable(en(["draft", "published"])) }),
    ),
    op("document", "publish", obj({})),
    op("document", "archive", obj({})),
    op("document", "schedule", obj({ publishAt: utc })),
    op(
      "navigation",
      "replace",
      obj({ items: arr({ $ref: "#/$defs/nav" }, npNavigationLimits.maxItems) }),
    ),
    op("theme_tokens", "replace", obj({ tokens })),
    op("setting", "replace", obj({ value: json }), resource.setting, nullable(base)),
    op("setting", "remove", obj({})),
    op("media_ref", "attach", obj({})),
    op("media_ref", "detach", obj({})),
  ],
};
const issue = obj({
  code: en(npAgentValidationIssueCodes),
  severity: en(["warning", "error"]),
  operationOrdinal: nullable(positive),
  path: str(1024),
  message: str(npAgentChangeSetLimits.explanatoryCharacters),
  evidenceRefs: arr(str(256), 24),
});
defs.operation = operation;
const operationWire = obj({
  ordinal: positive,
  operation: { $ref: "#/$defs/operation" },
  canonicalResourceKey: {
    oneOf: Object.entries(resource).map(([kind, schema]) =>
      obj({ kind: { const: kind }, ...(schema.properties as NpAgentJsonObject) }),
    ),
  },
  beforeHash: nullable(digest),
  afterHash: nullable(digest),
  state: en(["draft", "valid", "invalid", "applied", "verified", "failed"]),
  issues: arr(issue, npAgentChangeSetLimits.validationIssues),
  resultDigest: nullable(digest),
});
defs.operationWire = operationWire;
const artifact = obj({
  schemaVersion: { const: "np.agent-preview-artifact-ref.v1" },
  artifactId: uuid,
  ordinal: positive,
  kind: en(["screenshot", "report"]),
  route: nullable(str(2048)),
  locale: nullable(str(64)),
  viewport: nullable(
    obj({
      name: en(["desktop", "mobile"]),
      width: positive,
      height: positive,
      deviceScaleFactor: { type: "integer", enum: [1, 2] },
    }),
  ),
  reportPart: nullable(positive),
  reportTotalParts: nullable(positive),
  contentDigest: { ...str(54), pattern: "^ac1:sha256:[A-Za-z0-9_-]{43}$" },
  mime: en(["image/png", "image/webp", "application/json"]),
  bytes: positive,
  resourceUri: str(2048),
  createdAt: utc,
  expiresAt: utc,
});
defs.artifact = artifact;
const preview = obj({
  schemaVersion: { const: "np.agent-preview-summary.v1" },
  previewId: uuid,
  state: en(["queued", "rendering", "ready", "failed", "expired"]),
  generation: positive,
  planHash: digest,
  previewContractFingerprint: digest,
  digest: nullable(digest),
  artifactCount: { type: "integer", minimum: 0, maximum: npAgentChangeSetLimits.previewArtifacts },
  artifactRefs: arr({ $ref: "#/$defs/artifact" }, npAgentChangeSetLimits.previewArtifacts),
  interactiveLaunch: nullable(obj({ previewId: uuid, adminLaunchOperation: str(256) })),
  expiresAt: nullable(utc),
});
defs.preview = preview;
export const npAgentApprovalWireSchemaV1 = obj({
  id: uuid,
  generation: positive,
  state: en(["pending", "approved", "rejected", "expired", "consumed", "revoked"]),
  statementHash: digest,
  requiredHumanCapabilities: arr(en(npCapabilities), npCapabilities.length),
  requiredHumanPredicates: arr(en(npAgentHumanPredicates), npAgentHumanPredicates.length),
  requestedAt: utc,
  expiresAt: utc,
  decidedAt: nullable(utc),
});
export const npAgentExecutionSummarySchemaV1 = obj({
  executionId: uuid,
  state: en(["reserved", "committed", "verifying", "succeeded", "failed", "ambiguous"]),
  resultDigest: nullable(digest),
  startedAt: utc,
  finishedAt: nullable(utc),
});
export const npAgentVerificationSummarySchemaV1 = obj({
  state: en(["queued", "running", "passed", "failed"]),
  requiredPassed: natural,
  requiredFailed: natural,
  advisoryWarnings: natural,
  digest: nullable(digest),
  completedAt: nullable(utc),
});
export const npAgentChangeSetWireSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...obj({
    schemaVersion: { const: "np.agent-changeset.v1" },
    id: uuid,
    siteId: { ...str(63), pattern: npSiteIdPattern },
    title: { ...str(npAgentChangeSetLimits.explanatoryCharacters), minLength: 1 },
    summary: nullable(str(npAgentChangeSetLimits.explanatoryCharacters)),
    state: en(npAgentChangeSetStates),
    actor: obj({
      id: { anyOf: [uuid, digest] },
      kind: en(["runtime", "external", "staff"]),
      name: str(120),
    }),
    agentId: nullable(uuid),
    agentVersionId: nullable(uuid),
    agentConfigHash: nullable(digest),
    runId: nullable(uuid),
    planHash: nullable(digest),
    baseFingerprint: nullable(digest),
    draftVersion: positive,
    draftHash: digest,
    risk: nullable(
      obj({
        level: en(npAgentRiskLevels),
        reasonCodes: arr(en(npAgentRiskReasonCodes), npAgentRiskReasonCodes.length),
        approvalMode: { const: "human" },
        reversible: boolean,
      }),
    ),
    operations: arr({ $ref: "#/$defs/operationWire" }, npAgentChangeSetLimits.operations),
    validation: nullable(
      obj({
        state: en(["queued", "running", "valid", "invalid", "failed"]),
        generation: positive,
        issueCount: natural,
        digest: nullable(digest),
        completedAt: nullable(utc),
      }),
    ),
    preview: nullable({ $ref: "#/$defs/preview" }),
    approval: nullable(npAgentApprovalWireSchemaV1),
    schedule: nullable(obj({ at: utc })),
    execution: nullable(npAgentExecutionSummarySchemaV1),
    verification: nullable(npAgentVerificationSummarySchemaV1),
    rollback: nullable(
      obj({
        rollbackPlanId: uuid,
        generation: positive,
        state: en(npAgentRollbackPlanStates),
        planHash: nullable(digest),
        approvalId: nullable(uuid),
        operationCount: natural,
        createdAt: utc,
        expiresAt: utc,
        finishedAt: nullable(utc),
        terminalReason: nullable(
          en([
            "validation_failed",
            "snapshot_expired",
            "conflict",
            "policy_blocked",
            "approval_rejected",
            "approval_revoked",
            "approval_expired",
            "operator_cancelled",
            "execution_cancelled",
            "execution_failed",
            "verification_failed",
          ]),
        ),
      }),
    ),
    createdAt: utc,
    updatedAt: utc,
    expiresAt: utc,
  }),
  $defs: defs,
};
export const npAgentChangeSetCreateInputSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...obj({
    title: { ...str(npAgentChangeSetLimits.explanatoryCharacters), minLength: 1 },
    summary: nullable(str(npAgentChangeSetLimits.explanatoryCharacters)),
    operations: arr({ $ref: "#/$defs/operation" }, npAgentChangeSetLimits.operations),
  }),
  $defs: defs,
};
const { $defs: _defs, $schema: _dialect, ...wireNode } = npAgentChangeSetWireSchemaV1;
const outputDefs = { ...defs, changeset: wireNode };
export const npAgentChangeSetOutputSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...obj({
    schemaVersion: { const: "np.agent-changeset-result.v1" },
    changeSet: { $ref: "#/$defs/changeset" },
  }),
  $defs: outputDefs,
};
export const npAgentChangeSetListOutputSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...obj({
    schemaVersion: { const: "np.agent-changeset-list.v1" },
    items: arr({ $ref: "#/$defs/changeset" }, 100),
    nextCursor: nullable(str(2048)),
  }),
  $defs: outputDefs,
};

export function npCompactAgentWireSchemaV1(source: NpAgentJsonSchema): NpAgentJsonSchema {
  type Node = Record<string, unknown>;
  const counts = new Map<string, { node: Node; count: number }>();
  function children(node: Node, visit: (node: Node) => Node): Node {
    const out: Node = { ...node };
    for (const key of ["properties", "patternProperties", "$defs"])
      if (node[key] && typeof node[key] === "object")
        out[key] = Object.fromEntries(
          Object.entries(node[key] as Node).map(([name, value]) => [name, visit(value as Node)]),
        );
    for (const key of ["items", "additionalProperties", "not", "if", "then", "else"])
      if (node[key] && typeof node[key] === "object" && !Array.isArray(node[key]))
        out[key] = visit(node[key] as Node);
    for (const key of ["oneOf", "anyOf", "allOf"])
      if (Array.isArray(node[key])) out[key] = (node[key] as Node[]).map(visit);
    return out;
  }
  function count(node: Node): Node {
    const signature = JSON.stringify(node);
    if (signature.length >= 40 && !node.$ref) {
      const prior = counts.get(signature);
      counts.set(signature, { node, count: (prior?.count ?? 0) + 1 });
    }
    children(node, count);
    return node;
  }
  count(source);
  const names = new Map<string, string>();
  let sequence = 0;
  const originalDefinitions = source.$defs as Node | undefined;
  for (const [signature, value] of counts)
    if (value.count > 1) {
      let name: string;
      do {
        name = `wireShared${(sequence++).toString()}`;
      } while (originalDefinitions && Object.hasOwn(originalDefinitions, name));
      names.set(signature, name);
    }
  function compact(node: Node, definition = false): Node {
    const name = names.get(JSON.stringify(node));
    if (name && !definition) return { $ref: `#/$defs/${name}` };
    return children(node, (child) => compact(child));
  }
  const result = compact(source, true);
  const defs = { ...(result.$defs as Node) };
  for (const [signature, name] of names) defs[name] = compact(counts.get(signature)!.node, true);
  return npRequireAgentContractResult(
    npAnalyzeAgentJsonSchema({ ...result, $defs: defs }),
    "Invalid approval detail schema",
  );
}
