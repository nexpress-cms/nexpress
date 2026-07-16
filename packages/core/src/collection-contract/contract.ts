import type {
  NpCollectionConfig,
  NpFieldConfig,
  NpFindOptions,
  NpFindResult,
} from "../config/types.js";
import { npValidateBlockContent } from "../fields/block-content.js";
import { npValidateRichTextContent } from "../fields/rich-text.js";
import { npI18nContractLimits, npRequireLocale } from "../i18n-contract/index.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import {
  npCollectionDocumentStatuses,
  npCollectionDocumentVisibilities,
  type NpCollectionContractIssue,
  type NpCollectionContractResult,
  type NpCollectionDocumentRelations,
  type NpCollectionDocumentWire,
  type NpCollectionJsonValue,
} from "./types.js";

export const npCollectionContractLimits = {
  documentFields: 1_024,
  arrayRows: 10_000,
  stringLength: 2_000_000,
  slugLength: 96,
  localeLength: npI18nContractLimits.localeLength,
  jsonDepth: 64,
  jsonNodes: 100_000,
  jsonKeys: 10_000,
  jsonKeyLength: 160,
} as const;

export const npCollectionDocumentCanonicalDatePattern =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
export const npCollectionDocumentSlugPattern = "^(?:/|[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*)$";

export function npNormalizeCollectionDocumentSlug(value: string): string {
  if (value === "/") return value;
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(normalized)
    .slice(0, npCollectionContractLimits.slugLength)
    .join("")
    .replace(/-+$/u, "");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DOCUMENT_STATUSES = new Set<string>(npCollectionDocumentStatuses);
const VISIBILITIES = new Set<string>(npCollectionDocumentVisibilities);
const CANONICAL_DATE_PATTERN = new RegExp(npCollectionDocumentCanonicalDatePattern, "u");
const CANONICAL_SLUG_PATTERN = new RegExp(npCollectionDocumentSlugPattern, "u");

type DateMode = "runtime" | "wire";

interface InspectedRecord {
  readonly fields: Record<string, unknown>;
  readonly keys: readonly string[];
}

interface JsonState {
  nodes: number;
  keys: number;
  readonly ancestors: Set<object>;
}

export class NpCollectionContractError extends TypeError {
  readonly issues: readonly NpCollectionContractIssue[];

  constructor(message: string, issues: readonly NpCollectionContractIssue[]) {
    const first = issues[0];
    super(first ? `${message}: ${first.path}: ${first.message}` : message);
    this.name = "NpCollectionContractError";
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(
  code: NpCollectionContractIssue["code"],
  path: string,
  message: string,
): NpCollectionContractIssue {
  return { code, path, message };
}

function result<T>(
  value: T | null,
  issues: NpCollectionContractIssue[],
): NpCollectionContractResult<T> {
  return issues.length === 0 && value !== null
    ? { ok: true, value, issues: [] }
    : { ok: false, value: null, issues: Object.freeze(issues) };
}

function requireResult<T>(parsed: NpCollectionContractResult<T>, message: string): T {
  if (parsed.ok) return parsed.value;
  throw new NpCollectionContractError(message, parsed.issues);
}

function inspectRecord(
  value: unknown,
  path: string,
  issues: NpCollectionContractIssue[],
): InspectedRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(issue("shape", path, "must be a plain object."));
    return null;
  }
  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    ownKeys = Reflect.ownKeys(value);
  } catch {
    issues.push(issue("shape", path, "must be an inspectable plain object."));
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    issues.push(issue("shape", path, "must be a plain object."));
    return null;
  }
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const keys: string[] = [];
  for (const ownKey of ownKeys) {
    if (typeof ownKey !== "string") {
      issues.push(issue("unknown-field", path, "must not contain symbol properties."));
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    } catch {
      issues.push(issue("shape", `${path}.${ownKey}`, "must be inspectable."));
      continue;
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      issues.push(
        issue("shape", `${path}.${ownKey}`, "must be an enumerable plain data property."),
      );
      continue;
    }
    fields[ownKey] = descriptor.value;
    keys.push(ownKey);
  }
  if (keys.length > npCollectionContractLimits.documentFields) {
    issues.push(
      issue(
        "max-items",
        path,
        `may contain at most ${npCollectionContractLimits.documentFields.toString()} fields.`,
      ),
    );
  }
  return { fields, keys };
}

function inspectArray(
  value: unknown,
  path: string,
  issues: NpCollectionContractIssue[],
): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    issues.push(issue("shape", path, "must be an array."));
    return null;
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    issues.push(issue("shape", path, "must use the built-in Array prototype."));
    return null;
  }
  if (value.length > npCollectionContractLimits.arrayRows) {
    issues.push(
      issue(
        "max-items",
        path,
        `may contain at most ${npCollectionContractLimits.arrayRows.toString()} rows.`,
      ),
    );
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      issues.push(issue("unknown-field", path, "must not contain custom properties."));
      return null;
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      issues.push(issue("shape", `${path}[${index.toString()}]`, "must not be sparse."));
    }
  }
  return value;
}

function exactKeys(
  inspected: InspectedRecord,
  expected: ReadonlySet<string>,
  path: string,
  issues: NpCollectionContractIssue[],
): void {
  for (const key of inspected.keys) {
    if (!expected.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, "is not part of this collection."));
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(inspected.fields, key)) {
      issues.push(issue("shape", `${path}.${key}`, "is required by the collection contract."));
    }
  }
}

function boundedString(
  value: unknown,
  path: string,
  issues: NpCollectionContractIssue[],
  maximum: number = npCollectionContractLimits.stringLength,
  allowEmpty = true,
): string | null {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!allowEmpty && value.length === 0) ||
    !isWellFormedUnicode(value) ||
    value.includes("\0")
  ) {
    issues.push(issue("invalid-field", path, "must be bounded well-formed text."));
    return null;
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function uuid(value: unknown, path: string, issues: NpCollectionContractIssue[]): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    issues.push(issue("invalid-field", path, "must be a UUID."));
    return null;
  }
  return value;
}

function nullableUuid(
  value: unknown,
  path: string,
  issues: NpCollectionContractIssue[],
): string | null {
  return value === null ? null : uuid(value, path, issues);
}

function dateValue(
  value: unknown,
  path: string,
  mode: DateMode,
  issues: NpCollectionContractIssue[],
): Date | string | null {
  if (mode === "runtime") {
    if (
      !(value instanceof Date) ||
      Number.isNaN(value.valueOf()) ||
      !CANONICAL_DATE_PATTERN.test(value.toISOString())
    ) {
      issues.push(issue("invalid-field", path, "must be a valid Date."));
      return null;
    }
    return new Date(value.valueOf());
  }
  if (typeof value !== "string" || !CANONICAL_DATE_PATTERN.test(value)) {
    issues.push(issue("invalid-field", path, "must be a canonical UTC ISO timestamp."));
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    issues.push(issue("invalid-field", path, "must be a canonical UTC ISO timestamp."));
    return null;
  }
  return value;
}

function canonicalLocale(
  value: unknown,
  path: string,
  issues: NpCollectionContractIssue[],
): string | null {
  try {
    return npRequireLocale(value, path);
  } catch {
    issues.push(issue("invalid-field", path, "must be a canonical BCP 47 locale tag."));
    return null;
  }
}

function canonicalSlug(
  value: unknown,
  path: string,
  issues: NpCollectionContractIssue[],
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Array.from(value).length > npCollectionContractLimits.slugLength ||
    !isWellFormedUnicode(value) ||
    value.includes("\0")
  ) {
    issues.push(issue("invalid-field", path, "must be a bounded well-formed slug."));
    return null;
  }
  if (!CANONICAL_SLUG_PATTERN.test(value) || value !== npNormalizeCollectionDocumentSlug(value)) {
    issues.push(
      issue(
        "invalid-field",
        path,
        'must be "/" or a lowercase letter-or-number slug with single hyphen separators.',
      ),
    );
  }
  return value;
}

function normalizeJson(
  value: unknown,
  path: string,
  depth: number,
  state: JsonState,
  issues: NpCollectionContractIssue[],
): NpCollectionJsonValue | null {
  state.nodes += 1;
  if (state.nodes > npCollectionContractLimits.jsonNodes) {
    issues.push(issue("max-items", path, "contains too many JSON values."));
    return null;
  }
  if (depth > npCollectionContractLimits.jsonDepth) {
    issues.push(issue("max-items", path, "exceeds the maximum JSON depth."));
    return null;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.push(issue("invalid-field", path, "JSON numbers must be finite."));
      return null;
    }
    return value;
  }
  if (typeof value === "string") return boundedString(value, path, issues);
  if (typeof value !== "object" || value === null) {
    issues.push(issue("invalid-field", path, "must be JSON-compatible."));
    return null;
  }
  if (state.ancestors.has(value)) {
    issues.push(issue("invariant", path, "must not contain circular references."));
    return null;
  }
  state.ancestors.add(value);
  if (Array.isArray(value)) {
    const array = inspectArray(value, path, issues);
    if (!array) {
      state.ancestors.delete(value);
      return null;
    }
    const normalized: NpCollectionJsonValue[] = [];
    for (const [index, child] of array.entries()) {
      normalized.push(
        normalizeJson(child, `${path}[${index.toString()}]`, depth + 1, state, issues),
      );
    }
    state.ancestors.delete(value);
    return normalized;
  }
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) {
    state.ancestors.delete(value);
    return null;
  }
  const normalized: Record<string, NpCollectionJsonValue> = {};
  for (const key of inspected.keys) {
    state.keys += 1;
    if (state.keys > npCollectionContractLimits.jsonKeys) {
      issues.push(issue("max-items", path, "contains too many JSON keys."));
      continue;
    }
    if (
      key.length === 0 ||
      key.length > npCollectionContractLimits.jsonKeyLength ||
      !isWellFormedUnicode(key) ||
      key.includes("\0")
    ) {
      issues.push(issue("invalid-field", `${path}.${key}`, "has an invalid JSON key."));
      continue;
    }
    const child = inspected.fields[key];
    if (child === undefined) {
      issues.push(issue("invalid-field", `${path}.${key}`, "must not be undefined."));
      continue;
    }
    Object.defineProperty(normalized, key, {
      value: normalizeJson(child, `${path}.${key}`, depth + 1, state, issues),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  state.ancestors.delete(value);
  return normalized;
}

export function npAnalyzeCollectionJsonValue(
  value: unknown,
  path = "value",
): NpCollectionContractResult<NpCollectionJsonValue> {
  const issues: NpCollectionContractIssue[] = [];
  const normalized = normalizeJson(
    value,
    path,
    0,
    { nodes: 0, keys: 0, ancestors: new Set() },
    issues,
  );
  return issues.length === 0
    ? { ok: true, value: normalized, issues: [] }
    : { ok: false, value: null, issues: Object.freeze(issues) };
}

export function npRequireCollectionJsonValue(
  value: unknown,
  path = "value",
): NpCollectionJsonValue {
  return requireResult(npAnalyzeCollectionJsonValue(value, path), "Invalid collection JSON value");
}

function normalizeFieldValue(
  field: Exclude<NpFieldConfig, { type: "row" | "collapsible" | "group" | "array" }>,
  value: unknown,
  path: string,
  mode: DateMode,
  issues: NpCollectionContractIssue[],
): unknown {
  if (value === null) {
    if (field.required) issues.push(issue("invalid-field", path, "must not be null."));
    return null;
  }
  switch (field.type) {
    case "text":
    case "textarea": {
      const parsed = boundedString(value, path, issues);
      if (parsed !== null) {
        if (field.minLength !== undefined && parsed.length < field.minLength) {
          issues.push(
            issue(
              "invalid-field",
              path,
              `must contain at least ${field.minLength.toString()} characters.`,
            ),
          );
        }
        if (field.maxLength !== undefined && parsed.length > field.maxLength) {
          issues.push(
            issue(
              "invalid-field",
              path,
              `must contain at most ${field.maxLength.toString()} characters.`,
            ),
          );
        }
      }
      return parsed;
    }
    case "email": {
      const parsed = boundedString(value, path, issues, 320, false);
      if (parsed !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(parsed)) {
        issues.push(issue("invalid-field", path, "must be an email address."));
      }
      return parsed;
    }
    case "select":
    case "radio": {
      const parsed = boundedString(value, path, issues);
      if (parsed !== null && !field.options.some((option) => option.value === parsed)) {
        issues.push(issue("invalid-field", path, "must use a declared option value."));
      }
      return parsed;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(issue("invalid-field", path, "must be a finite number."));
        return null;
      }
      if (field.integerOnly && !Number.isSafeInteger(value)) {
        issues.push(issue("invalid-field", path, "must be a safe integer."));
      }
      if (field.min !== undefined && value < field.min) {
        issues.push(issue("invalid-field", path, `must be at least ${field.min.toString()}.`));
      }
      if (field.max !== undefined && value > field.max) {
        issues.push(issue("invalid-field", path, `must be at most ${field.max.toString()}.`));
      }
      return value;
    case "checkbox":
      if (typeof value !== "boolean") {
        issues.push(issue("invalid-field", path, "must be boolean."));
        return null;
      }
      return value;
    case "date":
      return dateValue(value, path, mode, issues);
    case "upload":
      return uuid(value, path, issues);
    case "relationship":
      if (field.hasMany) {
        const array = inspectArray(value, path, issues);
        if (!array) return [];
        const seen = new Set<string>();
        return array.map((entry, index) => {
          const parsed = uuid(entry, `${path}[${index.toString()}]`, issues);
          if (parsed && seen.has(parsed)) {
            issues.push(
              issue("duplicate", `${path}[${index.toString()}]`, "duplicates a relationship id."),
            );
          }
          if (parsed) seen.add(parsed);
          return parsed;
        });
      }
      return uuid(value, path, issues);
    case "richText": {
      const parsed = npValidateRichTextContent(value);
      if (!parsed.ok) issues.push(issue("invalid-field", path, parsed.message));
      return value;
    }
    case "blocks": {
      const parsed = npValidateBlockContent(value);
      if (!parsed.ok) issues.push(issue("invalid-field", path, parsed.message));
      return value;
    }
    case "json":
      return normalizeJson(value, path, 0, { nodes: 0, keys: 0, ancestors: new Set() }, issues);
  }
}

function topLevelFields(fields: readonly NpFieldConfig[]): NpFieldConfig[] {
  return fields.flatMap((field) =>
    field.type === "row" || field.type === "collapsible" ? topLevelFields(field.fields) : [field],
  );
}

function flattenedName(prefix: readonly string[], name: string): string {
  if (prefix.length === 0) return name;
  return `${prefix[0]}${prefix.slice(1).map(upperFirst).join("")}${upperFirst(name)}`;
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasDeclaredPublishedAt(config: NpCollectionConfig): boolean {
  return topLevelFields(config.fields).some(
    (field) => "name" in field && field.name === "publishedAt",
  );
}

function publicSystemKeys(config: NpCollectionConfig): string[] {
  return [
    "id",
    "status",
    "createdBy",
    "updatedBy",
    "visibility",
    "siteId",
    ...(config.timestamps === false ? [] : ["createdAt", "updatedAt"]),
    ...(config.community?.memberWrite?.create ? ["memberAuthorId"] : []),
    ...(config.slugField ? ["slug"] : []),
    ...(config.i18n ? ["locale", "translationGroupId"] : []),
    ...(config.versions?.drafts && !hasDeclaredPublishedAt(config) ? ["publishedAt"] : []),
  ];
}

function storageFieldKeys(
  fields: readonly NpFieldConfig[],
  prefix: readonly string[] = [],
): string[] {
  const keys: string[] = [];
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      keys.push(...storageFieldKeys(field.fields, prefix));
    } else if (field.type === "group") {
      keys.push(...storageFieldKeys(field.fields, [...prefix, field.name]));
    } else if (field.type !== "array" && !(field.type === "relationship" && field.hasMany)) {
      keys.push(flattenedName(prefix, field.name));
    }
  }
  return keys;
}

function publicFieldKeys(fields: readonly NpFieldConfig[]): string[] {
  return topLevelFields(fields).map((field) => ("name" in field ? field.name : ""));
}

function normalizeSystemFields(
  config: NpCollectionConfig,
  fields: Record<string, unknown>,
  path: string,
  mode: DateMode,
  issues: NpCollectionContractIssue[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    id: uuid(fields.id, `${path}.id`, issues),
    status:
      typeof fields.status === "string" && DOCUMENT_STATUSES.has(fields.status)
        ? fields.status
        : null,
    createdBy: nullableUuid(fields.createdBy, `${path}.createdBy`, issues),
    updatedBy: nullableUuid(fields.updatedBy, `${path}.updatedBy`, issues),
    visibility:
      typeof fields.visibility === "string" && VISIBILITIES.has(fields.visibility)
        ? fields.visibility
        : null,
    siteId: npIsCanonicalSiteId(fields.siteId) ? fields.siteId : null,
  };
  if (normalized.status === null) {
    issues.push(issue("invalid-field", `${path}.status`, "must be a canonical document status."));
  }
  if (normalized.visibility === null) {
    issues.push(issue("invalid-field", `${path}.visibility`, "must be public or private."));
  }
  if (normalized.siteId === null) {
    issues.push(issue("invalid-field", `${path}.siteId`, "must be a canonical site id."));
  }
  if (config.timestamps !== false) {
    normalized.createdAt = dateValue(fields.createdAt, `${path}.createdAt`, mode, issues);
    normalized.updatedAt = dateValue(fields.updatedAt, `${path}.updatedAt`, mode, issues);
  }
  if (config.community?.memberWrite?.create) {
    normalized.memberAuthorId = nullableUuid(
      fields.memberAuthorId,
      `${path}.memberAuthorId`,
      issues,
    );
  }
  if (config.slugField) {
    normalized.slug = canonicalSlug(fields.slug, `${path}.slug`, issues);
  }
  if (config.i18n) {
    normalized.locale = canonicalLocale(fields.locale, `${path}.locale`, issues);
    normalized.translationGroupId = uuid(
      fields.translationGroupId,
      `${path}.translationGroupId`,
      issues,
    );
  }
  if (config.versions?.drafts && !hasDeclaredPublishedAt(config)) {
    normalized.publishedAt =
      fields.publishedAt === null
        ? null
        : dateValue(fields.publishedAt, `${path}.publishedAt`, mode, issues);
  }
  return normalized;
}

function normalizePublicFields(
  fields: readonly NpFieldConfig[],
  source: Record<string, unknown>,
  path: string,
  mode: DateMode,
  issues: NpCollectionContractIssue[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(normalized, normalizePublicFields(field.fields, source, path, mode, issues));
      continue;
    }
    const fieldPath = `${path}.${field.name}`;
    if (field.type === "group") {
      const value = source[field.name];
      if (value === null) {
        if (field.required) issues.push(issue("invalid-field", fieldPath, "must not be null."));
        normalized[field.name] = null;
        continue;
      }
      const inspected = inspectRecord(value, fieldPath, issues);
      if (!inspected) {
        normalized[field.name] = null;
        continue;
      }
      exactKeys(inspected, new Set(publicFieldKeys(field.fields)), fieldPath, issues);
      normalized[field.name] = normalizePublicFields(
        field.fields,
        inspected.fields,
        fieldPath,
        mode,
        issues,
      );
      continue;
    }
    if (field.type === "array") {
      const rows = inspectArray(source[field.name], fieldPath, issues);
      if (!rows) {
        normalized[field.name] = [];
        continue;
      }
      if (field.minRows !== undefined && rows.length < field.minRows) {
        issues.push(
          issue(
            "invalid-field",
            fieldPath,
            `must contain at least ${field.minRows.toString()} rows.`,
          ),
        );
      }
      if (field.maxRows !== undefined && rows.length > field.maxRows) {
        issues.push(
          issue(
            "invalid-field",
            fieldPath,
            `must contain at most ${field.maxRows.toString()} rows.`,
          ),
        );
      }
      normalized[field.name] = rows.map((row, index) => {
        const rowPath = `${fieldPath}[${index.toString()}]`;
        const inspected = inspectRecord(row, rowPath, issues);
        if (!inspected) return {};
        exactKeys(inspected, new Set(publicFieldKeys(field.fields)), rowPath, issues);
        return normalizePublicFields(field.fields, inspected.fields, rowPath, mode, issues);
      });
      continue;
    }
    normalized[field.name] = normalizeFieldValue(
      field,
      source[field.name],
      fieldPath,
      mode,
      issues,
    );
  }
  return normalized;
}

function analyzeDocument(
  value: unknown,
  config: NpCollectionConfig,
  mode: DateMode,
  path: string,
): NpCollectionContractResult<Record<string, unknown>> {
  const issues: NpCollectionContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return result<Record<string, unknown>>(null, issues);
  const expected = new Set([...publicSystemKeys(config), ...publicFieldKeys(config.fields)]);
  exactKeys(inspected, expected, path, issues);
  const normalized = {
    ...normalizeSystemFields(config, inspected.fields, path, mode, issues),
    ...normalizePublicFields(config.fields, inspected.fields, path, mode, issues),
  };
  return result(normalized, issues);
}

export function npAnalyzeCollectionDocument(
  value: unknown,
  config: NpCollectionConfig,
  path = "document",
): NpCollectionContractResult<Record<string, unknown>> {
  return analyzeDocument(value, config, "runtime", path);
}

export function npRequireCollectionDocument<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
  path = "document",
): T {
  return requireResult(
    npAnalyzeCollectionDocument(value, config, path),
    "Invalid collection document",
  ) as T;
}

export function npAnalyzeCollectionDocumentWire(
  value: unknown,
  config: NpCollectionConfig,
  path = "document",
): NpCollectionContractResult<Record<string, unknown>> {
  return analyzeDocument(value, config, "wire", path);
}

export function npRequireCollectionDocumentWire<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
  path = "document",
): NpCollectionDocumentWire<T> {
  return requireResult(
    npAnalyzeCollectionDocumentWire(value, config, path),
    "Invalid collection document wire value",
  ) as NpCollectionDocumentWire<T>;
}

function normalizeStorageScalarFields(
  fields: readonly NpFieldConfig[],
  source: Record<string, unknown>,
  path: string,
  issues: NpCollectionContractIssue[],
  prefix: readonly string[] = [],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(
        normalized,
        normalizeStorageScalarFields(field.fields, source, path, issues, prefix),
      );
    } else if (field.type === "group") {
      Object.assign(
        normalized,
        normalizeStorageScalarFields(field.fields, source, path, issues, [...prefix, field.name]),
      );
    } else if (field.type !== "array" && !(field.type === "relationship" && field.hasMany)) {
      const name = flattenedName(prefix, field.name);
      normalized[name] = normalizeFieldValue(
        field,
        source[name],
        `${path}.${name}`,
        "runtime",
        issues,
      );
    }
  }
  return normalized;
}

export function npAnalyzeCollectionStorageRow(
  value: unknown,
  config: NpCollectionConfig,
  path = "document.storage",
): NpCollectionContractResult<Record<string, unknown>> {
  const issues: NpCollectionContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return result<Record<string, unknown>>(null, issues);
  const expected = new Set([
    ...publicSystemKeys(config),
    ...storageFieldKeys(config.fields),
    "searchVector",
  ]);
  exactKeys(inspected, expected, path, issues);
  const normalized = {
    ...normalizeSystemFields(config, inspected.fields, path, "runtime", issues),
    ...normalizeStorageScalarFields(config.fields, inspected.fields, path, issues),
    searchVector:
      inspected.fields.searchVector === null
        ? null
        : boundedString(inspected.fields.searchVector, `${path}.searchVector`, issues),
  };
  return result(normalized, issues);
}

export function npRequireCollectionStorageRow(
  value: unknown,
  config: NpCollectionConfig,
  path = "document.storage",
): Record<string, unknown> {
  return requireResult(
    npAnalyzeCollectionStorageRow(value, config, path),
    "Invalid persisted collection row",
  );
}

function projectStorageFields(
  fields: readonly NpFieldConfig[],
  source: Record<string, unknown>,
  prefix: readonly string[] = [],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(projected, projectStorageFields(field.fields, source, prefix));
    } else if (field.type === "group") {
      const nested = projectStorageFields(field.fields, source, [...prefix, field.name]);
      const values = Object.values(nested);
      projected[field.name] =
        !field.required && values.every((value) => value === null) ? null : nested;
    } else if (field.type !== "array" && !(field.type === "relationship" && field.hasMany)) {
      projected[field.name] = source[flattenedName(prefix, field.name)];
    }
  }
  return projected;
}

function hydrateArrayRows(
  field: Extract<NpFieldConfig, { type: "array" }>,
  rowsValue: unknown,
  documentId: string,
  path: string,
  issues: NpCollectionContractIssue[],
): Record<string, unknown>[] {
  const rows = inspectArray(rowsValue, path, issues) ?? [];
  const seenIds = new Set<string>();
  return rows.map((row, index) => {
    const rowPath = `${path}[${index.toString()}]`;
    const inspected = inspectRecord(row, rowPath, issues);
    if (!inspected) return {};
    const expected = new Set(["id", "parentId", "order", ...storageFieldKeys(field.fields)]);
    exactKeys(inspected, expected, rowPath, issues);
    const id = uuid(inspected.fields.id, `${rowPath}.id`, issues);
    if (id !== null && seenIds.has(id)) {
      issues.push(issue("duplicate", `${rowPath}.id`, "duplicates another child row id."));
    }
    if (id !== null) seenIds.add(id);
    const parentId = uuid(inspected.fields.parentId, `${rowPath}.parentId`, issues);
    if (parentId !== null && parentId !== documentId) {
      issues.push(issue("invariant", `${rowPath}.parentId`, "must reference the owning document."));
    }
    if (inspected.fields.order !== index) {
      issues.push(issue("invariant", `${rowPath}.order`, "must be contiguous and zero-based."));
    }
    const normalizedStorage = normalizeStorageScalarFields(
      field.fields,
      inspected.fields,
      rowPath,
      issues,
    );
    return projectStorageFields(field.fields, normalizedStorage);
  });
}

function relationFieldPaths(
  fields: readonly NpFieldConfig[],
  kind: "arrays" | "hasMany",
  prefix: readonly string[] = [],
): Set<string> {
  const paths = new Set<string>();
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      for (const path of relationFieldPaths(field.fields, kind, prefix)) paths.add(path);
    } else if (field.type === "group") {
      for (const path of relationFieldPaths(field.fields, kind, [...prefix, field.name])) {
        paths.add(path);
      }
    } else if (
      (kind === "arrays" && field.type === "array") ||
      (kind === "hasMany" && field.type === "relationship" && field.hasMany)
    ) {
      paths.add([...prefix, field.name].join("."));
    }
  }
  return paths;
}

function inspectRelations(
  value: unknown,
  config: NpCollectionConfig,
  issues: NpCollectionContractIssue[],
): NpCollectionDocumentRelations {
  const inspected = inspectRecord(value, "document.relations", issues);
  if (!inspected) return {};
  for (const key of inspected.keys) {
    if (key !== "arrays" && key !== "hasMany") {
      issues.push(
        issue("unknown-field", `document.relations.${key}`, "is not a relation inventory."),
      );
    }
  }
  const normalized: {
    arrays?: Record<string, readonly unknown[]>;
    hasMany?: Record<string, readonly unknown[]>;
  } = {};
  for (const kind of ["arrays", "hasMany"] as const) {
    const expected = relationFieldPaths(config.fields, kind);
    const candidate = inspected.fields[kind];
    if (candidate === undefined) {
      if (expected.size > 0) {
        issues.push(
          issue(
            "shape",
            `document.relations.${kind}`,
            "is required for this collection's relation inventory.",
          ),
        );
      }
      continue;
    }
    const inventory = inspectRecord(candidate, `document.relations.${kind}`, issues);
    if (!inventory) continue;
    exactKeys(inventory, expected, `document.relations.${kind}`, issues);
    const values: Record<string, readonly unknown[]> = {};
    for (const fieldPath of inventory.keys) {
      if (!expected.has(fieldPath)) {
        continue;
      }
      const rows = inspectArray(
        inventory.fields[fieldPath],
        `document.relations.${kind}.${fieldPath}`,
        issues,
      );
      if (rows) values[fieldPath] = rows;
    }
    normalized[kind] = values;
  }
  return normalized;
}

function hydratePublicFields(
  fields: readonly NpFieldConfig[],
  storage: Record<string, unknown>,
  relations: NpCollectionDocumentRelations,
  issues: NpCollectionContractIssue[],
  prefix: readonly string[] = [],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(
        projected,
        hydratePublicFields(field.fields, storage, relations, issues, prefix),
      );
      continue;
    }
    if (field.type === "group") {
      const nested = hydratePublicFields(field.fields, storage, relations, issues, [
        ...prefix,
        field.name,
      ]);
      projected[field.name] =
        !field.required && Object.values(nested).every((value) => value === null) ? null : nested;
      continue;
    }
    const fieldPath = [...prefix, field.name].join(".");
    if (field.type === "array") {
      projected[field.name] = hydrateArrayRows(
        field,
        relations.arrays?.[fieldPath] ?? [],
        storage.id as string,
        `document.${fieldPath}`,
        issues,
      );
      continue;
    }
    if (field.type === "relationship" && field.hasMany) {
      const ids = inspectArray(
        relations.hasMany?.[fieldPath] ?? [],
        `document.${fieldPath}`,
        issues,
      );
      projected[field.name] = ids
        ? ids.map((entry, index) =>
            uuid(entry, `document.${fieldPath}[${index.toString()}]`, issues),
          )
        : [];
      continue;
    }
    projected[field.name] = storage[flattenedName(prefix, field.name)];
  }
  return projected;
}

export function npHydrateCollectionDocument<T extends object = Record<string, unknown>>(
  config: NpCollectionConfig,
  storageValue: unknown,
  relations: NpCollectionDocumentRelations = {},
): T {
  const storage = npRequireCollectionStorageRow(storageValue, config);
  const relationIssues: NpCollectionContractIssue[] = [];
  const inspectedRelations = inspectRelations(relations, config, relationIssues);
  const publicValue: Record<string, unknown> = {};
  for (const key of publicSystemKeys(config)) publicValue[key] = storage[key];
  Object.assign(
    publicValue,
    hydratePublicFields(config.fields, storage, inspectedRelations, relationIssues),
  );
  if (relationIssues.length > 0) {
    throw new NpCollectionContractError("Invalid persisted collection relations", relationIssues);
  }
  return npRequireCollectionDocument<T>(publicValue, config);
}

function serializeFieldValue(field: NpFieldConfig, value: unknown): unknown {
  if (value === null) return null;
  if (field.type === "date") return (value as Date).toISOString();
  if (field.type === "group" && typeof value === "object" && value !== null) {
    return serializeFields(field.fields, value as Record<string, unknown>);
  }
  if (field.type === "array" && Array.isArray(value)) {
    return value.map((row) => serializeFields(field.fields, row as Record<string, unknown>));
  }
  return value;
}

function serializeFields(
  fields: readonly NpFieldConfig[],
  source: Record<string, unknown>,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(serialized, serializeFields(field.fields, source));
    } else {
      serialized[field.name] = serializeFieldValue(field, source[field.name]);
    }
  }
  return serialized;
}

export function npSerializeCollectionDocument<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
): NpCollectionDocumentWire<T> {
  const document = npRequireCollectionDocument<Record<string, unknown>>(value, config);
  const serialized: Record<string, unknown> = {};
  for (const key of publicSystemKeys(config)) {
    const candidate = document[key];
    serialized[key] = candidate instanceof Date ? candidate.toISOString() : candidate;
  }
  Object.assign(serialized, serializeFields(config.fields, document));
  return npRequireCollectionDocumentWire<T>(serialized, config);
}

function parseWireFieldValue(field: NpFieldConfig, value: unknown): unknown {
  if (value === null) return null;
  if (field.type === "date") return new Date(value as string);
  if (field.type === "group" && typeof value === "object" && value !== null) {
    return parseWireFields(field.fields, value as Record<string, unknown>);
  }
  if (field.type === "array" && Array.isArray(value)) {
    return value.map((row) => parseWireFields(field.fields, row as Record<string, unknown>));
  }
  return value;
}

function parseWireFields(
  fields: readonly NpFieldConfig[],
  source: Record<string, unknown>,
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(parsed, parseWireFields(field.fields, source));
    } else {
      parsed[field.name] = parseWireFieldValue(field, source[field.name]);
    }
  }
  return parsed;
}

export function npParseCollectionDocumentWire<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
): T {
  const wire = npRequireCollectionDocumentWire<Record<string, unknown>>(value, config);
  const parsed: Record<string, unknown> = {};
  for (const key of publicSystemKeys(config)) {
    const candidate = wire[key];
    parsed[key] =
      (key === "createdAt" || key === "updatedAt" || key === "publishedAt") &&
      typeof candidate === "string"
        ? new Date(candidate)
        : candidate;
  }
  Object.assign(parsed, parseWireFields(config.fields, wire));
  return npRequireCollectionDocument<T>(parsed, config);
}

export function npCollectionDocumentToWriteInput(
  value: unknown,
  config: NpCollectionConfig,
): Record<string, unknown> {
  const document = npRequireCollectionDocument<Record<string, unknown>>(value, config);
  const input = serializeFields(config.fields, document);
  if (config.slugField) input.slug = document.slug;
  input.visibility = document.visibility;
  if (config.i18n) {
    input.locale = document.locale;
    input.translationGroupId = document.translationGroupId;
  }
  if (config.versions?.drafts && !hasDeclaredPublishedAt(config)) {
    input.publishedAt = document.publishedAt;
  }
  return input;
}

type QueryableField = Exclude<
  NpFieldConfig,
  { type: "row" | "collapsible" | "group" | "array" | "richText" | "blocks" | "json" }
>;

type QueryFieldDescriptor =
  | { readonly kind: "system"; readonly name: string }
  | { readonly kind: "field"; readonly field: QueryableField };

function collectQueryFieldDescriptors(
  fields: readonly NpFieldConfig[],
  prefix: readonly string[] = [],
): Array<readonly [string, QueryFieldDescriptor]> {
  const descriptors: Array<readonly [string, QueryFieldDescriptor]> = [];
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      descriptors.push(...collectQueryFieldDescriptors(field.fields, prefix));
    } else if (field.type === "group") {
      descriptors.push(...collectQueryFieldDescriptors(field.fields, [...prefix, field.name]));
    } else if (
      field.type !== "array" &&
      field.type !== "richText" &&
      field.type !== "blocks" &&
      field.type !== "json"
    ) {
      const name =
        field.type === "relationship" && field.hasMany
          ? field.name
          : flattenedName(prefix, field.name);
      descriptors.push([name, { kind: "field", field }]);
    }
  }
  return descriptors;
}

function findFieldDescriptors(config: NpCollectionConfig): Map<string, QueryFieldDescriptor> {
  return new Map([
    ...publicSystemKeys(config).map((name) => [name, { kind: "system", name }] as const),
    ...collectQueryFieldDescriptors(config.fields),
  ]);
}

function normalizeQueryScalar(
  descriptor: QueryFieldDescriptor,
  value: unknown,
  path: string,
  allowSystemWildcards: boolean,
  issues: NpCollectionContractIssue[],
): unknown {
  // `NpFindWhere` intentionally unwraps optional document fields and does not
  // expose null matching. Reject null instead of confusing it with the
  // parser's failure sentinel and silently broadening the query.
  if (value === null) {
    issues.push(issue("invalid-field", path, "must not be null."));
    return null;
  }
  if (descriptor.kind === "system") {
    if ((descriptor.name === "siteId" || descriptor.name === "visibility") && value === "*") {
      if (!allowSystemWildcards) {
        issues.push(issue("invalid-field", path, "does not accept a public wildcard."));
      }
      return value;
    }
    if (
      descriptor.name === "id" ||
      descriptor.name === "createdBy" ||
      descriptor.name === "updatedBy" ||
      descriptor.name === "memberAuthorId" ||
      descriptor.name === "translationGroupId"
    ) {
      return uuid(value, path, issues);
    }
    if (descriptor.name === "status") {
      if (typeof value !== "string" || !DOCUMENT_STATUSES.has(value)) {
        issues.push(issue("invalid-field", path, "must be a canonical document status."));
        return null;
      }
      return value;
    }
    if (descriptor.name === "visibility") {
      if (typeof value !== "string" || !VISIBILITIES.has(value)) {
        issues.push(issue("invalid-field", path, "must be public or private."));
        return null;
      }
      return value;
    }
    if (descriptor.name === "siteId") {
      if (!npIsCanonicalSiteId(value)) {
        issues.push(issue("invalid-field", path, "must be a canonical site id."));
        return null;
      }
      return value;
    }
    if (descriptor.name === "locale") {
      return canonicalLocale(value, path, issues);
    }
    if (descriptor.name === "slug") {
      return canonicalSlug(value, path, issues);
    }
    if (
      descriptor.name === "createdAt" ||
      descriptor.name === "updatedAt" ||
      descriptor.name === "publishedAt"
    ) {
      if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value) return parsed;
      }
      return dateValue(value, path, "runtime", issues);
    }
    return boundedString(value, path, issues, npCollectionContractLimits.slugLength, false);
  }

  const field = descriptor.field;
  if (field.type === "relationship" && field.hasMany) return uuid(value, path, issues);
  if (field.type === "date" && typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value) return parsed;
  }
  return normalizeFieldValue(field, value, path, "runtime", issues);
}

export function npAnalyzeCollectionFindOptions<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
  options: { readonly maximumLimit?: number; readonly allowSystemWildcards?: boolean } = {},
): NpCollectionContractResult<NpFindOptions<T>> {
  const issues: NpCollectionContractIssue[] = [];
  const inspected = inspectRecord(value, "find", issues);
  if (!inspected) return result<NpFindOptions<T>>(null, issues);
  const expected = new Set(["page", "limit", "sort", "search", "where", "locale"]);
  for (const key of inspected.keys) {
    if (!expected.has(key)) issues.push(issue("unknown-field", `find.${key}`, "is not supported."));
  }
  const normalized: NpFindOptions<T> = {};
  const maximumLimit = options.maximumLimit ?? 10_000;
  for (const key of ["page", "limit"] as const) {
    const candidate = inspected.fields[key];
    if (candidate === undefined) continue;
    const maximum = key === "limit" ? maximumLimit : Number.MAX_SAFE_INTEGER;
    if (
      !Number.isSafeInteger(candidate) ||
      (candidate as number) < 1 ||
      (candidate as number) > maximum
    ) {
      issues.push(
        issue(
          "invalid-field",
          `find.${key}`,
          `must be an integer from 1 through ${maximum.toString()}.`,
        ),
      );
    } else {
      normalized[key] = candidate as number;
    }
  }
  const effectivePage = normalized.page ?? 1;
  const effectiveLimit = normalized.limit ?? 10;
  if (effectivePage - 1 > Math.floor(Number.MAX_SAFE_INTEGER / effectiveLimit)) {
    issues.push(issue("invariant", "find.page", "would produce an unsafe pagination offset."));
  }
  const fieldDescriptors = findFieldDescriptors(config);
  const sort = inspected.fields.sort;
  if (sort !== undefined) {
    const parsed = boundedString(sort, "find.sort", issues, 129, false);
    const field = parsed?.startsWith("-") ? parsed.slice(1) : parsed;
    const descriptor = field ? fieldDescriptors.get(field) : undefined;
    if (
      !field ||
      !descriptor ||
      (descriptor.kind === "field" &&
        descriptor.field.type === "relationship" &&
        descriptor.field.hasMany)
    ) {
      issues.push(issue("invalid-field", "find.sort", "must name a sortable collection field."));
    } else {
      normalized.sort = parsed ?? undefined;
    }
  }
  const search = inspected.fields.search;
  if (search !== undefined) {
    const parsed = boundedString(search, "find.search", issues, 1_000, false);
    if (parsed !== null) normalized.search = parsed;
  }
  const locale = inspected.fields.locale;
  if (locale !== undefined) {
    const parsed = canonicalLocale(locale, "find.locale", issues);
    if (!config.i18n) {
      issues.push(issue("invalid-field", "find.locale", "is supported only by i18n collections."));
    } else if (parsed !== null) {
      normalized.locale = parsed;
    }
  }
  const where = inspected.fields.where;
  if (where !== undefined) {
    const whereRecord = inspectRecord(where, "find.where", issues);
    if (whereRecord) {
      const normalizedWhere: Record<string, unknown> = {};
      for (const key of whereRecord.keys) {
        const descriptor = fieldDescriptors.get(key);
        if (!descriptor) {
          issues.push(
            issue("unknown-field", `find.where.${key}`, "is not a queryable collection field."),
          );
          continue;
        }
        const candidate = whereRecord.fields[key];
        if (
          Array.isArray(candidate) &&
          (key === "siteId" || key === "visibility") &&
          candidate.includes("*")
        ) {
          issues.push(
            issue(
              "invalid-field",
              `find.where.${key}`,
              "accepts the internal wildcard only as a scalar value.",
            ),
          );
        }
        const values = Array.isArray(candidate) ? candidate : [candidate];
        if (values.length > 1_000) {
          issues.push(issue("max-items", `find.where.${key}`, "may contain at most 1000 values."));
          continue;
        }
        const normalizedValues = values.map((entry, index) =>
          normalizeQueryScalar(
            descriptor,
            entry,
            Array.isArray(candidate)
              ? `find.where.${key}[${index.toString()}]`
              : `find.where.${key}`,
            options.allowSystemWildcards ?? false,
            issues,
          ),
        );
        if (normalizedValues.some((entry) => entry === null)) {
          continue;
        }
        normalizedWhere[key] = Array.isArray(candidate) ? normalizedValues : normalizedValues[0];
      }
      normalized.where = normalizedWhere as NpFindOptions<T>["where"];
    }
  }
  const whereLocale = (normalized.where as Record<string, unknown> | undefined)?.locale;
  if (
    normalized.locale !== undefined &&
    whereLocale !== undefined &&
    whereLocale !== normalized.locale
  ) {
    issues.push(
      issue(
        "invariant",
        "find.locale",
        "must match find.where.locale when both locale filters are provided.",
      ),
    );
  }
  return result(normalized, issues);
}

export function npRequireCollectionFindOptions<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
  options: { readonly maximumLimit?: number; readonly allowSystemWildcards?: boolean } = {},
): NpFindOptions<T> {
  return requireResult(
    npAnalyzeCollectionFindOptions<T>(value, config, options),
    "Invalid collection find options",
  );
}

export function npAnalyzeCollectionFindResult<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
): NpCollectionContractResult<NpFindResult<T>> {
  const issues: NpCollectionContractIssue[] = [];
  const inspected = inspectRecord(value, "result", issues);
  if (!inspected) return result<NpFindResult<T>>(null, issues);
  const keys = [
    "docs",
    "totalDocs",
    "totalPages",
    "page",
    "limit",
    "hasNextPage",
    "hasPrevPage",
  ] as const;
  exactKeys(inspected, new Set(keys), "result", issues);
  const docs = inspectArray(inspected.fields.docs, "result.docs", issues) ?? [];
  const normalizedDocs = docs.map((document, index) => {
    const parsed = npAnalyzeCollectionDocument(
      document,
      config,
      `result.docs[${index.toString()}]`,
    );
    if (!parsed.ok) {
      issues.push(...parsed.issues);
      return {};
    }
    return parsed.value;
  });
  const normalized: Record<string, unknown> = { docs: normalizedDocs };
  for (const key of ["totalDocs", "totalPages", "page", "limit"] as const) {
    const candidate = inspected.fields[key];
    const minimum = key === "page" || key === "limit" ? 1 : 0;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < minimum) {
      issues.push(
        issue(
          "invalid-field",
          `result.${key}`,
          `must be an integer of at least ${minimum.toString()}.`,
        ),
      );
    } else normalized[key] = candidate;
  }
  for (const key of ["hasNextPage", "hasPrevPage"] as const) {
    if (typeof inspected.fields[key] !== "boolean") {
      issues.push(issue("invalid-field", `result.${key}`, "must be boolean."));
    } else normalized[key] = inspected.fields[key];
  }
  if (
    typeof normalized.totalPages === "number" &&
    typeof normalized.page === "number" &&
    typeof normalized.hasNextPage === "boolean" &&
    normalized.hasNextPage !== normalized.page < normalized.totalPages
  ) {
    issues.push(issue("invariant", "result.hasNextPage", "does not match page metadata."));
  }
  if (
    typeof normalized.totalDocs === "number" &&
    typeof normalized.totalPages === "number" &&
    typeof normalized.limit === "number" &&
    normalized.totalPages !==
      (normalized.totalDocs === 0 ? 0 : Math.ceil(normalized.totalDocs / normalized.limit))
  ) {
    issues.push(issue("invariant", "result.totalPages", "does not match totalDocs and limit."));
  }
  if (
    typeof normalized.page === "number" &&
    typeof normalized.totalDocs === "number" &&
    typeof normalized.hasPrevPage === "boolean" &&
    normalized.hasPrevPage !== (normalized.page > 1 && normalized.totalDocs > 0)
  ) {
    issues.push(issue("invariant", "result.hasPrevPage", "does not match page metadata."));
  }
  if (typeof normalized.limit === "number" && normalizedDocs.length > normalized.limit) {
    issues.push(issue("invariant", "result.docs", "must not contain more documents than limit."));
  }
  if (typeof normalized.totalDocs === "number" && normalizedDocs.length > normalized.totalDocs) {
    issues.push(issue("invariant", "result.docs", "must not exceed totalDocs."));
  }
  return result(normalized as unknown as NpFindResult<T>, issues);
}

export function npRequireCollectionFindResult<T extends object = Record<string, unknown>>(
  value: unknown,
  config: NpCollectionConfig,
): NpFindResult<T> {
  return requireResult(
    npAnalyzeCollectionFindResult<T>(value, config),
    "Invalid collection find result",
  );
}

/** Exact generic envelope used by doctor when project field definitions are unavailable. */
export function npAnalyzeCollectionSystemRow(
  value: unknown,
  path = "collection",
): NpCollectionContractResult<Record<string, unknown>> {
  const issues: NpCollectionContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return result<Record<string, unknown>>(null, issues);
  const expected = new Set(["id", "status", "createdBy", "updatedBy", "visibility", "siteId"]);
  exactKeys(inspected, expected, path, issues);
  const config = {
    slug: "doctor",
    labels: { singular: "Document", plural: "Documents" },
    timestamps: false,
    fields: [],
  } satisfies NpCollectionConfig;
  return result(normalizeSystemFields(config, inspected.fields, path, "runtime", issues), issues);
}
