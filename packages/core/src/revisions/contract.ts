import type { NpCollectionConfig, NpFieldConfig } from "../config/types.js";
import { npValidateBlockContent } from "../fields/block-content.js";
import { npValidateRichTextContent } from "../fields/rich-text.js";

export const NP_REVISION_STATUSES = ["draft", "published", "autosave"] as const;
export const npRevisionCanonicalDatePattern =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
export const npRevisionContractLimits = {
  depth: 128,
  nodes: 100_000,
  stringLength: 1_000_000,
  snapshotLength: 5_000_000,
  topLevelFields: 512,
} as const;

export type NpRevisionStatus = (typeof NP_REVISION_STATUSES)[number];
export type NpRevisionJsonPrimitive = string | number | boolean | null;
export type NpRevisionJsonValue =
  NpRevisionJsonPrimitive | NpRevisionJsonValue[] | { [key: string]: NpRevisionJsonValue };
export type NpRevisionSnapshot = Record<string, NpRevisionJsonValue>;

export interface NpRevisionContractIssue {
  path: string;
  message: string;
}

export type NpRevisionContractResult<T> =
  { ok: true; value: T } | { ok: false; issues: NpRevisionContractIssue[] };

export interface NpRevisionSummary {
  id: string;
  collection: string;
  documentId: string;
  version: number;
  status: NpRevisionStatus;
  changedFields: string[];
  authorId: string | null;
  createdAt: Date;
}

export interface NpRevision extends NpRevisionSummary {
  snapshot: NpRevisionSnapshot;
}

export interface NpRevisionWireSummary {
  id: string;
  version: number;
  status: NpRevisionStatus;
  changedFields: string[];
  authorId: string | null;
  createdAt: string;
}

export interface NpRevisionWire extends NpRevisionWireSummary {
  snapshot: NpRevisionSnapshot;
}

export interface NpRevisionWireList {
  revisions: NpRevisionWireSummary[];
  total: number;
}

export interface NpAutosaveRevisionWireResult {
  saved: boolean;
  revisionId: string;
  version: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COLLECTION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,127}$/u;
const ISO_DATE_PATTERN = new RegExp(npRevisionCanonicalDatePattern, "u");

export class NpRevisionContractError extends Error {
  readonly issues: NpRevisionContractIssue[];

  constructor(message: string, issues: NpRevisionContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpRevisionContractError";
    this.issues = issues;
  }
}

function issue(path: string, message: string): NpRevisionContractResult<never> {
  return { ok: false, issues: [{ path, message }] };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function normalizeJsonValue(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  state: { nodes: number },
): NpRevisionJsonValue | undefined {
  state.nodes += 1;
  if (state.nodes > npRevisionContractLimits.nodes) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      {
        path,
        message: `snapshot exceeds ${npRevisionContractLimits.nodes.toString()} JSON values`,
      },
    ]);
  }
  if (depth > npRevisionContractLimits.depth) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      {
        path,
        message: `snapshot exceeds the maximum depth of ${npRevisionContractLimits.depth.toString()}`,
      },
    ]);
  }
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > npRevisionContractLimits.stringLength) {
      throw new NpRevisionContractError("Invalid revision snapshot", [
        {
          path,
          message: `string exceeds ${npRevisionContractLimits.stringLength.toString()} characters`,
        },
      ]);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new NpRevisionContractError("Invalid revision snapshot", [
        { path, message: "number must be finite" },
      ]);
    }
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new NpRevisionContractError("Invalid revision snapshot", [
        { path, message: "date must be valid" },
      ]);
    }
    return value.toISOString();
  }
  if (typeof value !== "object" || (!Array.isArray(value) && !isPlainRecord(value))) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      { path, message: "value must be JSON-compatible" },
    ]);
  }
  if (ancestors.has(value)) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      { path, message: "value must not contain circular references" },
    ]);
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    const result: NpRevisionJsonValue[] = [];
    for (const [index, child] of value.entries()) {
      const normalized = normalizeJsonValue(
        child,
        `${path}[${index.toString()}]`,
        depth + 1,
        ancestors,
        state,
      );
      if (normalized === undefined) {
        ancestors.delete(value);
        throw new NpRevisionContractError("Invalid revision snapshot", [
          { path: `${path}[${index.toString()}]`, message: "array item must not be undefined" },
        ]);
      }
      result.push(normalized);
    }
    ancestors.delete(value);
    return result;
  }

  const result: Record<string, NpRevisionJsonValue> = {};
  for (const [key, child] of Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (key.length === 0 || key.length > 160) {
      ancestors.delete(value);
      throw new NpRevisionContractError("Invalid revision snapshot", [
        { path, message: "object keys must contain between 1 and 160 characters" },
      ]);
    }
    const normalized = normalizeJsonValue(child, `${path}.${key}`, depth + 1, ancestors, state);
    if (normalized !== undefined) {
      Object.defineProperty(result, key, {
        value: normalized,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  ancestors.delete(value);
  return result;
}

export function npNormalizeRevisionSnapshot(value: unknown): NpRevisionSnapshot {
  if (!isPlainRecord(value)) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      { path: "snapshot", message: "snapshot must be a plain object" },
    ]);
  }
  if (Object.keys(value).length > npRevisionContractLimits.topLevelFields) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      {
        path: "snapshot",
        message: `snapshot exceeds ${npRevisionContractLimits.topLevelFields.toString()} top-level fields`,
      },
    ]);
  }
  const normalized = normalizeJsonValue(value, "snapshot", 0, new WeakSet(), { nodes: 0 });
  if (!isPlainRecord(normalized)) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      { path: "snapshot", message: "snapshot must be a plain object" },
    ]);
  }
  const snapshot: NpRevisionSnapshot = normalized;
  if (JSON.stringify(snapshot).length > npRevisionContractLimits.snapshotLength) {
    throw new NpRevisionContractError("Invalid revision snapshot", [
      {
        path: "snapshot",
        message: `serialized snapshot exceeds ${npRevisionContractLimits.snapshotLength.toString()} characters`,
      },
    ]);
  }
  return snapshot;
}

function flattenFields(
  fields: NpFieldConfig[],
): Exclude<NpFieldConfig, { type: "row" | "collapsible" }>[] {
  return fields.flatMap((field) =>
    field.type === "row" || field.type === "collapsible" ? flattenFields(field.fields) : [field],
  );
}

function allowEmpty(value: unknown): boolean {
  return value === null || value === "";
}

function analyzeFields(
  value: Record<string, unknown>,
  fields: NpFieldConfig[],
  path: string,
  rejectUnknown = true,
): NpRevisionContractIssue[] {
  const issues: NpRevisionContractIssue[] = [];
  const flattened = flattenFields(fields);
  if (rejectUnknown) {
    const allowed = new Set(flattened.map((field) => field.name));
    issues.push(
      ...Object.keys(value)
        .filter((name) => !allowed.has(name))
        .map((name) => ({
          path: `${path}.${name}`,
          message: "field is not declared by the collection",
        })),
    );
  }
  for (const field of flattened) {
    if (!(field.name in value)) continue;
    const fieldValue = value[field.name];
    const fieldPath = `${path}.${field.name}`;
    if (allowEmpty(fieldValue)) continue;

    switch (field.type) {
      case "text":
      case "textarea":
        if (typeof fieldValue !== "string")
          issues.push({ path: fieldPath, message: "must be a string" });
        else if (field.maxLength !== undefined && fieldValue.length > field.maxLength)
          issues.push({
            path: fieldPath,
            message: `must contain at most ${field.maxLength.toString()} characters`,
          });
        break;
      case "email":
        if (typeof fieldValue !== "string")
          issues.push({ path: fieldPath, message: "must be a string" });
        break;
      case "number":
        if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))
          issues.push({ path: fieldPath, message: "must be a finite number" });
        break;
      case "checkbox":
        if (typeof fieldValue !== "boolean")
          issues.push({ path: fieldPath, message: "must be a boolean" });
        break;
      case "date":
        if (!isIsoDate(fieldValue))
          issues.push({ path: fieldPath, message: "must be a canonical UTC ISO date" });
        break;
      case "richText": {
        const result = npValidateRichTextContent(fieldValue);
        if (!result.ok) issues.push({ path: fieldPath, message: result.message });
        break;
      }
      case "blocks": {
        const result = npValidateBlockContent(fieldValue);
        if (!result.ok) issues.push({ path: fieldPath, message: result.message });
        else if (field.maxRows !== undefined && result.value.length > field.maxRows)
          issues.push({
            path: fieldPath,
            message: `must contain at most ${field.maxRows.toString()} blocks`,
          });
        break;
      }
      case "upload":
        if (typeof fieldValue !== "string" || !UUID_PATTERN.test(fieldValue))
          issues.push({ path: fieldPath, message: "must be a UUID" });
        break;
      case "relationship": {
        const values = field.hasMany ? fieldValue : [fieldValue];
        if (
          !Array.isArray(values) ||
          values.some((item) => typeof item !== "string" || !UUID_PATTERN.test(item))
        )
          issues.push({
            path: fieldPath,
            message: field.hasMany
              ? "must be an array of document UUIDs"
              : "must be a document UUID",
          });
        break;
      }
      case "select": {
        const allowed = new Set(field.options.map((option) => option.value));
        const values = field.hasMany ? fieldValue : [fieldValue];
        if (
          !Array.isArray(values) ||
          values.some((item) => typeof item !== "string" || !allowed.has(item))
        )
          issues.push({
            path: fieldPath,
            message: field.hasMany
              ? "must contain only declared option values"
              : "must be a declared option value",
          });
        break;
      }
      case "radio":
        if (
          typeof fieldValue !== "string" ||
          !field.options.some((option) => option.value === fieldValue)
        )
          issues.push({ path: fieldPath, message: "must be a declared option value" });
        break;
      case "array":
        if (!Array.isArray(fieldValue))
          issues.push({ path: fieldPath, message: "must be an array" });
        else {
          if (field.maxRows !== undefined && fieldValue.length > field.maxRows)
            issues.push({
              path: fieldPath,
              message: `must contain at most ${field.maxRows.toString()} rows`,
            });
          for (const [index, row] of fieldValue.entries()) {
            if (!isPlainRecord(row))
              issues.push({
                path: `${fieldPath}[${index.toString()}]`,
                message: "must be an object",
              });
            else
              issues.push(...analyzeFields(row, field.fields, `${fieldPath}[${index.toString()}]`));
          }
        }
        break;
      case "group":
        if (!isPlainRecord(fieldValue))
          issues.push({ path: fieldPath, message: "must be an object" });
        else issues.push(...analyzeFields(fieldValue, field.fields, fieldPath));
        break;
      case "json":
        break;
      default: {
        const exhaustive: never = field;
        return exhaustive;
      }
    }
  }
  return issues;
}

function snapshotFieldNames(config: NpCollectionConfig): Set<string> {
  const names = new Set(flattenFields(config.fields).map((field) => field.name));
  names.add("visibility");
  if (config.slugField) names.add("slug");
  if (config.i18n) {
    names.add("locale");
    names.add("translationGroupId");
  }
  if (config.versions?.drafts && !names.has("publishedAt")) names.add("publishedAt");
  return names;
}

export function npAnalyzeRevisionSnapshot(
  value: unknown,
  config?: NpCollectionConfig,
): NpRevisionContractResult<NpRevisionSnapshot> {
  let snapshot: NpRevisionSnapshot;
  try {
    snapshot = npNormalizeRevisionSnapshot(value);
  } catch (error) {
    if (error instanceof NpRevisionContractError) return { ok: false, issues: error.issues };
    return issue("snapshot", "snapshot is invalid");
  }
  if (!config) return { ok: true, value: snapshot };

  const allowed = snapshotFieldNames(config);
  const issues = Object.keys(snapshot)
    .filter((name) => !allowed.has(name))
    .map((name) => ({
      path: `snapshot.${name}`,
      message: "field is not declared by the collection",
    }));
  issues.push(...analyzeFields(snapshot, config.fields, "snapshot", false));

  for (const name of ["slug", "locale", "translationGroupId", "publishedAt"] as const) {
    const fieldValue = snapshot[name];
    if (fieldValue === undefined || allowEmpty(fieldValue) || allowed.has(name) === false) continue;
    if (name === "translationGroupId") {
      if (typeof fieldValue !== "string" || !UUID_PATTERN.test(fieldValue))
        issues.push({ path: `snapshot.${name}`, message: "must be a UUID" });
    } else if (name === "publishedAt") {
      if (!isIsoDate(fieldValue))
        issues.push({ path: `snapshot.${name}`, message: "must be a canonical UTC ISO date" });
    } else if (typeof fieldValue !== "string") {
      issues.push({ path: `snapshot.${name}`, message: "must be a string" });
    }
  }
  if (
    snapshot.visibility !== undefined &&
    snapshot.visibility !== null &&
    snapshot.visibility !== "" &&
    snapshot.visibility !== "public" &&
    snapshot.visibility !== "private"
  ) {
    issues.push({
      path: "snapshot.visibility",
      message: 'must be "public" or "private"',
    });
  }

  return issues.length === 0 ? { ok: true, value: snapshot } : { ok: false, issues };
}

function analyzeChangedFields(
  value: unknown,
  snapshot?: NpRevisionSnapshot,
): NpRevisionContractIssue[] {
  if (!Array.isArray(value)) return [{ path: "changedFields", message: "must be an array" }];
  const issues: NpRevisionContractIssue[] = [];
  const seen = new Set<string>();
  for (const [index, field] of value.entries()) {
    if (typeof field !== "string" || !FIELD_NAME_PATTERN.test(field)) {
      issues.push({
        path: `changedFields[${index.toString()}]`,
        message: "must be a valid field name",
      });
    } else if (seen.has(field)) {
      issues.push({
        path: `changedFields[${index.toString()}]`,
        message: "must not contain duplicates",
      });
    } else if (snapshot && !(field in snapshot)) {
      issues.push({
        path: `changedFields[${index.toString()}]`,
        message: "must reference a snapshot field",
      });
    }
    if (typeof field === "string") seen.add(field);
  }
  if ([...seen].sort().some((field, index) => field !== value[index])) {
    issues.push({ path: "changedFields", message: "must be sorted" });
  }
  return issues;
}

const INTERNAL_SUMMARY_KEYS = [
  "id",
  "collection",
  "documentId",
  "version",
  "status",
  "changedFields",
  "authorId",
  "createdAt",
] as const;
const WIRE_SUMMARY_KEYS = [
  "id",
  "version",
  "status",
  "changedFields",
  "authorId",
  "createdAt",
] as const;

export function npAnalyzeRevisionSummary(
  value: unknown,
): NpRevisionContractResult<NpRevisionSummary> {
  if (!isPlainRecord(value) || !hasExactKeys(value, INTERNAL_SUMMARY_KEYS))
    return issue("revision", "revision summary must contain only the exact contract fields");
  const issues: NpRevisionContractIssue[] = [];
  if (typeof value.id !== "string" || !UUID_PATTERN.test(value.id))
    issues.push({ path: "id", message: "must be a UUID" });
  if (
    typeof value.collection !== "string" ||
    value.collection.length > 63 ||
    !COLLECTION_PATTERN.test(value.collection)
  )
    issues.push({ path: "collection", message: "must be a canonical collection slug" });
  if (typeof value.documentId !== "string" || value.documentId.length === 0)
    issues.push({ path: "documentId", message: "must be a non-empty string" });
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1)
    issues.push({ path: "version", message: "must be a positive safe integer" });
  if (!NP_REVISION_STATUSES.includes(value.status as NpRevisionStatus))
    issues.push({ path: "status", message: "must be a supported revision status" });
  issues.push(...analyzeChangedFields(value.changedFields));
  if (
    value.authorId !== null &&
    (typeof value.authorId !== "string" || !UUID_PATTERN.test(value.authorId))
  )
    issues.push({ path: "authorId", message: "must be null or a UUID" });
  if (!(value.createdAt instanceof Date) || Number.isNaN(value.createdAt.getTime()))
    issues.push({ path: "createdAt", message: "must be a valid Date" });
  return issues.length === 0
    ? { ok: true, value: value as unknown as NpRevisionSummary }
    : { ok: false, issues };
}

export function npAnalyzeRevision(
  value: unknown,
  config?: NpCollectionConfig,
): NpRevisionContractResult<NpRevision> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [...INTERNAL_SUMMARY_KEYS, "snapshot"]))
    return issue("revision", "revision must contain only the exact contract fields");
  const summary = npAnalyzeRevisionSummary(
    Object.fromEntries(INTERNAL_SUMMARY_KEYS.map((key) => [key, value[key]])),
  );
  const snapshot = npAnalyzeRevisionSnapshot(value.snapshot, config);
  const issues = [...(summary.ok ? [] : summary.issues), ...(snapshot.ok ? [] : snapshot.issues)];
  if (snapshot.ok) issues.push(...analyzeChangedFields(value.changedFields, snapshot.value));
  return issues.length === 0
    ? {
        ok: true,
        value: {
          ...(summary as { ok: true; value: NpRevisionSummary }).value,
          snapshot: (snapshot as { ok: true; value: NpRevisionSnapshot }).value,
        },
      }
    : { ok: false, issues };
}

function analyzeWireSummary(value: unknown): NpRevisionContractResult<NpRevisionWireSummary> {
  if (!isPlainRecord(value) || !hasExactKeys(value, WIRE_SUMMARY_KEYS))
    return issue("revision", "wire revision summary must contain only the exact contract fields");
  const issues: NpRevisionContractIssue[] = [];
  if (typeof value.id !== "string" || !UUID_PATTERN.test(value.id))
    issues.push({ path: "id", message: "must be a UUID" });
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1)
    issues.push({ path: "version", message: "must be a positive safe integer" });
  if (!NP_REVISION_STATUSES.includes(value.status as NpRevisionStatus))
    issues.push({ path: "status", message: "must be a supported revision status" });
  issues.push(...analyzeChangedFields(value.changedFields));
  if (
    value.authorId !== null &&
    (typeof value.authorId !== "string" || !UUID_PATTERN.test(value.authorId))
  )
    issues.push({ path: "authorId", message: "must be null or a UUID" });
  if (!isIsoDate(value.createdAt))
    issues.push({ path: "createdAt", message: "must be a canonical UTC ISO date" });
  return issues.length === 0
    ? { ok: true, value: value as unknown as NpRevisionWireSummary }
    : { ok: false, issues };
}

export function npAnalyzeRevisionWire(value: unknown): NpRevisionContractResult<NpRevisionWire> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [...WIRE_SUMMARY_KEYS, "snapshot"]))
    return issue("revision", "wire revision must contain only the exact contract fields");
  const summary = analyzeWireSummary(
    Object.fromEntries(WIRE_SUMMARY_KEYS.map((key) => [key, value[key]])),
  );
  const snapshot = npAnalyzeRevisionSnapshot(value.snapshot);
  const issues = [...(summary.ok ? [] : summary.issues), ...(snapshot.ok ? [] : snapshot.issues)];
  if (snapshot.ok) issues.push(...analyzeChangedFields(value.changedFields, snapshot.value));
  return issues.length === 0
    ? {
        ok: true,
        value: {
          ...(summary as { ok: true; value: NpRevisionWireSummary }).value,
          snapshot: (snapshot as { ok: true; value: NpRevisionSnapshot }).value,
        },
      }
    : { ok: false, issues };
}

export function npAnalyzeRevisionWireList(
  value: unknown,
): NpRevisionContractResult<NpRevisionWireList> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["revisions", "total"]))
    return issue("response", "revision list must contain only revisions and total");
  if (!Array.isArray(value.revisions)) return issue("revisions", "must be an array");
  const issues: NpRevisionContractIssue[] = [];
  const revisions: NpRevisionWireSummary[] = [];
  for (const [index, row] of value.revisions.entries()) {
    const result = analyzeWireSummary(row);
    if (result.ok) revisions.push(result.value);
    else
      issues.push(
        ...result.issues.map((entry) => ({
          ...entry,
          path: `revisions[${index.toString()}].${entry.path}`,
        })),
      );
  }
  if (
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < 0 ||
    (value.total as number) < revisions.length
  )
    issues.push({
      path: "total",
      message: "must be a non-negative safe integer at least as large as revisions.length",
    });
  return issues.length === 0
    ? { ok: true, value: { revisions, total: value.total as number } }
    : { ok: false, issues };
}

export function npAnalyzeAutosaveRevisionWireResult(
  value: unknown,
): NpRevisionContractResult<NpAutosaveRevisionWireResult> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["saved", "revisionId", "version"]))
    return issue("response", "autosave result must contain only saved, revisionId, and version");
  const issues: NpRevisionContractIssue[] = [];
  if (typeof value.saved !== "boolean")
    issues.push({ path: "saved", message: "must be a boolean" });
  if (typeof value.revisionId !== "string" || !UUID_PATTERN.test(value.revisionId))
    issues.push({ path: "revisionId", message: "must be a UUID" });
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1)
    issues.push({ path: "version", message: "must be a positive safe integer" });
  return issues.length === 0
    ? { ok: true, value: value as unknown as NpAutosaveRevisionWireResult }
    : { ok: false, issues };
}

export function npSerializeRevisionSummary(value: NpRevisionSummary): NpRevisionWireSummary {
  const analyzed = npAnalyzeRevisionSummary(value);
  if (!analyzed.ok) throw new NpRevisionContractError("Invalid revision summary", analyzed.issues);
  const { id, version, status, changedFields, authorId, createdAt } = analyzed.value;
  return { id, version, status, changedFields, authorId, createdAt: createdAt.toISOString() };
}

export function npSerializeRevision(value: NpRevision): NpRevisionWire {
  const analyzed = npAnalyzeRevision(value);
  if (!analyzed.ok) throw new NpRevisionContractError("Invalid revision", analyzed.issues);
  const { snapshot, ...summary } = analyzed.value;
  return { ...npSerializeRevisionSummary(summary), snapshot };
}

export function npRevisionSnapshotKey(value: NpRevisionSnapshot): string {
  return JSON.stringify(npNormalizeRevisionSnapshot(value));
}
