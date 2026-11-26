import {
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodySha256Digest,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodyEnum,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npAgentEvaluationReportRecipesV1,
  type NpAgentEvaluationReportRecipeV1,
} from "./evaluation-report-contract.js";
import {
  npAgentEvaluationWorkbenchOutcomesV1,
  type NpAgentEvaluationWorkbenchOutcomeV1,
} from "./evaluation-workbench-contract.js";
import type { NpAgentJsonSchema } from "./types.js";

export const npAgentEvaluationHistoryRequestMaxBytesV1 = 4 * 1024 * 1024;
export const npAgentEvaluationHistorySourceMaxCharactersV1 = 2_000_000;
export interface NpAgentEvaluationHistorySaveV1 {
  schemaVersion: "np.agent-evaluation-history-save.v1";
  recipe: NpAgentEvaluationReportRecipeV1;
  evaluationJson: string;
  sourceHash: string;
  expectedVersion: number;
  caseId: string;
  caseVersion: number;
  caseHash: string;
  predictionHash: string;
  decision: null | {
    outcome: NpAgentEvaluationWorkbenchOutcomeV1;
    notes: string;
    editedProposalJson: string | null;
  };
  idempotencyKey: string;
}
export interface NpAgentEvaluationHistorySourceV1 {
  id: string;
  recipe: NpAgentEvaluationReportRecipeV1;
  sourceHash: string;
  version: number;
  caseCount: number;
  createdAt: string;
}
export interface NpAgentEvaluationHistoryRevisionV1 {
  id: string;
  version: number;
  caseId: string;
  caseVersion: number;
  caseHash: string;
  predictionHash: string;
  previousRevisionId: string | null;
  actorFingerprint: string;
  actorDeleted: boolean;
  recordedAt: string;
  /** A compatible offline label; authenticated provenance belongs to this envelope only. */
  labelJson: string | null;
  revisionHash: string;
}
export interface NpAgentEvaluationHistorySourcesV1 {
  schemaVersion: "np.agent-evaluation-history-sources.v1";
  sources: NpAgentEvaluationHistorySourceV1[];
  nextCursor: string | null;
}
export interface NpAgentEvaluationHistoryDetailV1 {
  schemaVersion: "np.agent-evaluation-history.v1";
  authority: "authenticated-staff-review-no-approval";
  source: NpAgentEvaluationHistorySourceV1;
  evaluationJson: string;
}
export interface NpAgentEvaluationHistoryCaseV1 {
  schemaVersion: "np.agent-evaluation-history-case.v1";
  authority: "authenticated-staff-review-no-approval";
  source: NpAgentEvaluationHistorySourceV1;
  caseId: string;
  caseVersion: number;
  revisions: NpAgentEvaluationHistoryRevisionV1[];
  nextBefore: number | null;
}
const path = "evaluation.history";
const rec = (v: unknown, keys: string[]) =>
  canonicalBodyRecord(v, path, keys, keys, { seen: new WeakSet() });
function fail(): never {
  throw new Error("Invalid bounded evaluation review history.");
}
function text(v: unknown, max: number, min = 0): string {
  if (
    typeof v !== "string" ||
    v.length < min ||
    v.length > max ||
    /[\p{Cc}\p{Cs}]/u.test(v.replace(/[\n\r\t]/gu, ""))
  )
    fail();
  return v;
}
function json(v: unknown, max: number): string {
  const s = text(v, max, 1);
  try {
    JSON.parse(s);
  } catch {
    fail();
  }
  return s;
}
const digest = (v: unknown) => canonicalBodySha256Digest(v, path);
const integer = (v: unknown, min = 1) => canonicalBodyInteger(v, path, min, 2147483646);
const recipe = (v: unknown) =>
  canonicalBodyEnum<NpAgentEvaluationReportRecipeV1>(
    v,
    path,
    new Set(npAgentEvaluationReportRecipesV1),
  );
const nullableId = (v: unknown) => (v === null ? null : canonicalBodyUuid(v, path));
function source(v: unknown): NpAgentEvaluationHistorySourceV1 {
  const r = rec(v, ["id", "recipe", "sourceHash", "version", "caseCount", "createdAt"]);
  return {
    id: canonicalBodyUuid(r.id, path),
    recipe: recipe(r.recipe),
    sourceHash: digest(r.sourceHash),
    version: integer(r.version),
    caseCount: canonicalBodyInteger(r.caseCount, path, 1, 100),
    createdAt: canonicalBodyUtc(r.createdAt, path),
  };
}
export function npRequireAgentEvaluationHistorySaveV1(v: unknown): NpAgentEvaluationHistorySaveV1 {
  const r = rec(
    cloneCanonicalRuntimeInput(v, path, npAgentEvaluationHistoryRequestMaxBytesV1, {
      maximumNodes: 100_000,
      maximumStringCharacters: npAgentEvaluationHistoryRequestMaxBytesV1,
    }),
    [
      "schemaVersion",
      "recipe",
      "evaluationJson",
      "sourceHash",
      "expectedVersion",
      "caseId",
      "caseVersion",
      "caseHash",
      "predictionHash",
      "decision",
      "idempotencyKey",
    ],
  );
  if (r.schemaVersion !== "np.agent-evaluation-history-save.v1") fail();
  const key = text(r.idempotencyKey, 128, 1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(key)) fail();
  let decision: NpAgentEvaluationHistorySaveV1["decision"] = null;
  if (r.decision !== null) {
    const d = rec(r.decision, ["outcome", "notes", "editedProposalJson"]);
    const outcome = canonicalBodyEnum<NpAgentEvaluationWorkbenchOutcomeV1>(
      d.outcome,
      path,
      new Set(npAgentEvaluationWorkbenchOutcomesV1),
    );
    const edited = d.editedProposalJson === null ? null : json(d.editedProposalJson, 256 * 1024);
    if ((outcome === "edit") !== (edited !== null)) fail();
    decision = { outcome, notes: text(d.notes, 2000), editedProposalJson: edited };
  }
  return {
    schemaVersion: r.schemaVersion,
    recipe: recipe(r.recipe),
    evaluationJson: json(r.evaluationJson, npAgentEvaluationHistorySourceMaxCharactersV1),
    sourceHash: digest(r.sourceHash),
    expectedVersion: integer(r.expectedVersion, 0),
    caseId: text(r.caseId, 128, 1),
    caseVersion: integer(r.caseVersion),
    caseHash: digest(r.caseHash),
    predictionHash: digest(r.predictionHash),
    decision,
    idempotencyKey: key,
  };
}
export function npRequireAgentEvaluationHistorySourcesV1(
  v: unknown,
): NpAgentEvaluationHistorySourcesV1 {
  const r = rec(cloneCanonicalRuntimeInput(v, path, 64 * 1024), [
    "schemaVersion",
    "sources",
    "nextCursor",
  ]);
  if (
    r.schemaVersion !== "np.agent-evaluation-history-sources.v1" ||
    !Array.isArray(r.sources) ||
    r.sources.length > 25
  )
    fail();
  return {
    schemaVersion: r.schemaVersion,
    sources: r.sources.map(source),
    nextCursor: nullableId(r.nextCursor),
  };
}
export function npRequireAgentEvaluationHistoryDetailV1(
  v: unknown,
): NpAgentEvaluationHistoryDetailV1 {
  const r = rec(
    cloneCanonicalRuntimeInput(v, path, 4 * 1024 * 1024, {
      maximumStringCharacters: npAgentEvaluationHistorySourceMaxCharactersV1,
    }),
    ["schemaVersion", "authority", "source", "evaluationJson"],
  );
  if (
    r.schemaVersion !== "np.agent-evaluation-history.v1" ||
    r.authority !== "authenticated-staff-review-no-approval"
  )
    fail();
  return {
    schemaVersion: r.schemaVersion,
    authority: r.authority,
    source: source(r.source),
    evaluationJson: json(r.evaluationJson, npAgentEvaluationHistorySourceMaxCharactersV1),
  };
}
export function npRequireAgentEvaluationHistoryCaseV1(v: unknown): NpAgentEvaluationHistoryCaseV1 {
  const r = rec(
    cloneCanonicalRuntimeInput(v, path, 4 * 1024 * 1024, { maximumStringCharacters: 512 * 1024 }),
    ["schemaVersion", "authority", "source", "caseId", "caseVersion", "revisions", "nextBefore"],
  );
  if (
    r.schemaVersion !== "np.agent-evaluation-history-case.v1" ||
    r.authority !== "authenticated-staff-review-no-approval" ||
    !Array.isArray(r.revisions) ||
    r.revisions.length > 10
  )
    fail();
  const caseId = text(r.caseId, 128, 1),
    caseVersion = integer(r.caseVersion);
  let prior = 2147483647;
  const revisions = r.revisions.map((v): NpAgentEvaluationHistoryRevisionV1 => {
    const x = rec(v, [
      "id",
      "version",
      "caseId",
      "caseVersion",
      "caseHash",
      "predictionHash",
      "previousRevisionId",
      "actorFingerprint",
      "actorDeleted",
      "recordedAt",
      "labelJson",
      "revisionHash",
    ]);
    const version = integer(x.version);
    if (
      version >= prior ||
      x.caseId !== caseId ||
      x.caseVersion !== caseVersion ||
      typeof x.actorDeleted !== "boolean"
    )
      fail();
    prior = version;
    return {
      id: canonicalBodyUuid(x.id, path),
      version,
      caseId,
      caseVersion,
      caseHash: digest(x.caseHash),
      predictionHash: digest(x.predictionHash),
      previousRevisionId: nullableId(x.previousRevisionId),
      actorFingerprint: digest(x.actorFingerprint),
      actorDeleted: x.actorDeleted,
      recordedAt: canonicalBodyUtc(x.recordedAt, path),
      labelJson: x.labelJson === null ? null : json(x.labelJson, 300 * 1024),
      revisionHash: digest(x.revisionHash),
    };
  });
  return {
    schemaVersion: r.schemaVersion,
    authority: r.authority,
    source: source(r.source),
    caseId,
    caseVersion,
    revisions,
    nextBefore: r.nextBefore === null ? null : integer(r.nextBefore),
  };
}
export const npAgentEvaluationHistorySaveSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: "np.agent-evaluation-history-save.v1" },
    recipe: { enum: [...npAgentEvaluationReportRecipesV1] },
    evaluationJson: {
      type: "string",
      minLength: 1,
      maxLength: npAgentEvaluationHistorySourceMaxCharactersV1,
    },
    sourceHash: { type: "string", maxLength: 60 },
    expectedVersion: { type: "integer", minimum: 0, maximum: 2147483646 },
    caseId: { type: "string", minLength: 1, maxLength: 128 },
    caseVersion: { type: "integer", minimum: 1, maximum: 2147483646 },
    caseHash: { type: "string", maxLength: 60 },
    predictionHash: { type: "string", maxLength: 60 },
    decision: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            outcome: { enum: [...npAgentEvaluationWorkbenchOutcomesV1] },
            notes: { type: "string", maxLength: 2000 },
            editedProposalJson: { type: ["string", "null"], maxLength: 256 * 1024 },
          },
          required: ["outcome", "notes", "editedProposalJson"],
        },
      ],
    },
    idempotencyKey: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    },
  },
  required: [
    "schemaVersion",
    "recipe",
    "evaluationJson",
    "sourceHash",
    "expectedVersion",
    "caseId",
    "caseVersion",
    "caseHash",
    "predictionHash",
    "decision",
    "idempotencyKey",
  ],
};

export function npRequireAgentEvaluationHistorySavedV1(value: unknown): {
  resourceId: string;
  replayed: boolean;
} {
  const r = rec(value, ["resourceId", "replayed"]);
  if (typeof r.replayed !== "boolean") fail();
  return { resourceId: canonicalBodyUuid(r.resourceId, path), replayed: r.replayed };
}
export const npAgentEvaluationHistorySavedSchemaV1: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    resourceId: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      maxLength: 36,
    },
    replayed: { type: "boolean" },
  },
  required: ["resourceId", "replayed"],
};
