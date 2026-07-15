import IntlMessageFormat from "intl-messageformat";

import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import type {
  NpI18nConfig,
  NpI18nConfigResponse,
  NpI18nContractIssue,
  NpI18nContractResult,
  NpI18nStringCell,
  NpI18nStringRow,
  NpI18nStringsResponse,
  NpCollectionTranslationProgress,
  NpResolveLocaleInput,
  NpStringOverrideCatalog,
  NpStringOverrideDeleteQuery,
  NpStringOverrideMutation,
  NpStringOverrideRow,
  NpTranslationBundle,
  NpTranslationCatalog,
  NpTranslationProgress,
  NpTranslationProgressLocaleStats,
  NpTranslationProgressResponse,
  NpTranslationParams,
} from "./types.js";

export const npI18nContractLimits = {
  acceptLanguageEntries: 100,
  acceptLanguageLength: 8_192,
  bundleKeys: 10_000,
  catalogLocales: 100,
  localeLength: 35,
  messageLength: 100_000,
  pathnameLength: 8_192,
  translationKeyLength: 256,
  translationParams: 100,
  translationParamKeyLength: 128,
  translationParamStringLength: 100_000,
  adminRows: 10_000,
  progressCollections: 100,
} as const;

const configKeys = new Set(["locales", "defaultLocale"]);
const resolveInputKeys = new Set(["pathname", "acceptLanguage"]);
const mutationKeys = new Set(["locale", "key", "value"]);
const deleteQueryKeys = new Set(["locale", "key"]);
const overrideRowKeys = new Set(["siteId", "locale", "key", "value", "updatedAt", "updatedBy"]);
const configDisabledKeys = new Set(["enabled"]);
const configEnabledKeys = new Set(["enabled", "locales", "defaultLocale"]);
const stringsResponseKeys = new Set(["locales", "defaultLocale", "keys", "siteId"]);
const stringRowKeys = new Set(["key", "values"]);
const stringCellKeys = new Set(["base", "override"]);
const progressKeys = new Set(["defaultLocale", "locales", "collections"]);
const progressCollectionKeys = new Set(["collection", "totalGroups", "perLocale"]);
const progressLocaleKeys = new Set(["count", "missing"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const collectionSlugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

interface InspectedRecord {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly keys: readonly string[];
}

export class NpI18nContractError extends TypeError {
  readonly issues: readonly NpI18nContractIssue[];

  constructor(message: string, issues: readonly NpI18nContractIssue[]) {
    const first = issues[0];
    super(first ? `${message}: ${first.path}: ${first.message}` : message);
    this.name = "NpI18nContractError";
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(
  code: NpI18nContractIssue["code"],
  path: string,
  message: string,
): NpI18nContractIssue {
  return { code, path, message };
}

function fail<T>(issues: readonly NpI18nContractIssue[]): NpI18nContractResult<T> {
  return { ok: false, value: null, issues: Object.freeze([...issues]) };
}

function pass<T>(value: T): NpI18nContractResult<T> {
  return { ok: true, value, issues: Object.freeze([]) };
}

function requireResult<T>(result: NpI18nContractResult<T>, message: string): T {
  if (!result.ok) throw new NpI18nContractError(message, result.issues);
  return result.value;
}

function inspectRecord(
  value: unknown,
  path: string,
  issues: NpI18nContractIssue[],
): InspectedRecord | null {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "must be an inspectable plain object."));
    return null;
  }
  if (typeof value !== "object" || value === null || isArray) {
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
      issues.push(issue("unknown-field", path, "must not contain symbol keys."));
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    } catch {
      issues.push(issue("shape", `${path}.${ownKey}`, "must be inspectable."));
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue(
          "shape",
          `${path}.${ownKey}`,
          "must be an enumerable data property; accessors are not supported.",
        ),
      );
      continue;
    }
    fields[ownKey] = descriptor.value;
    keys.push(ownKey);
  }
  return { fields, keys };
}

function inspectArray(
  value: unknown,
  path: string,
  maximum: number,
  issues: NpI18nContractIssue[],
): readonly unknown[] | null {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "must be an inspectable array."));
    return null;
  }
  if (!isArray) {
    issues.push(issue("shape", path, "must be an array."));
    return null;
  }
  const array = value as unknown[];
  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(array) as object | null;
    ownKeys = Reflect.ownKeys(array);
    lengthDescriptor = Object.getOwnPropertyDescriptor(array, "length");
  } catch {
    issues.push(issue("shape", path, "must be an inspectable array."));
    return null;
  }
  if (prototype !== Array.prototype) {
    issues.push(issue("shape", path, "must use the built-in Array prototype."));
    return null;
  }
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    issues.push(issue("shape", `${path}.length`, "must be an inspectable array length."));
    return null;
  }
  if (length > maximum) {
    issues.push(issue("max-items", path, `may contain at most ${maximum.toString()} items.`));
    return null;
  }
  for (const ownKey of ownKeys) {
    if (ownKey === "length") continue;
    if (typeof ownKey !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(ownKey)) {
      issues.push(issue("unknown-field", path, "must not contain custom properties."));
      return null;
    }
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array, index);
    } catch {
      issues.push(issue("shape", `${path}.${index.toString()}`, "must be inspectable."));
      return null;
    }
    if (!descriptor) {
      issues.push(issue("shape", `${path}.${index.toString()}`, "must not be sparse."));
      return null;
    }
    if (!("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue(
          "shape",
          `${path}.${index.toString()}`,
          "must be an enumerable data property; accessors are not supported.",
        ),
      );
      return null;
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function pushUnknown(
  record: InspectedRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpI18nContractIssue[],
): void {
  for (const key of record.keys) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported field "${key}".`));
    }
  }
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

function hasUnsafeCodePoint(value: string, allowLineBreaks: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 0 ||
      code === 0x7f ||
      code === 0xfffe ||
      code === 0xffff ||
      (code < 0x20 && (!allowLineBreaks || ![0x09, 0x0a, 0x0d].includes(code)))
    ) {
      return true;
    }
  }
  return false;
}

function analyzeLocale(value: unknown, path: string, issues: NpI18nContractIssue[]): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npI18nContractLimits.localeLength ||
    !isWellFormedUnicode(value) ||
    hasUnsafeCodePoint(value, false)
  ) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must be a canonical BCP 47 tag of at most ${npI18nContractLimits.localeLength.toString()} characters.`,
      ),
    );
    return null;
  }
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(value)[0];
  } catch {
    canonical = undefined;
  }
  if (!canonical || canonical !== value) {
    issues.push(issue("invalid-field", path, `locale "${value}" must be a canonical BCP 47 tag.`));
    return null;
  }
  return value;
}

function analyzeKey(value: unknown, path: string, issues: NpI18nContractIssue[]): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npI18nContractLimits.translationKeyLength ||
    value.trim() !== value ||
    !isWellFormedUnicode(value) ||
    hasUnsafeCodePoint(value, false)
  ) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must be trimmed, non-empty, safe text of at most ${npI18nContractLimits.translationKeyLength.toString()} characters.`,
      ),
    );
    return null;
  }
  return value;
}

function analyzeMessage(
  value: unknown,
  locale: string | null,
  path: string,
  issues: NpI18nContractIssue[],
): string | null {
  if (
    typeof value !== "string" ||
    value.length > npI18nContractLimits.messageLength ||
    !isWellFormedUnicode(value) ||
    hasUnsafeCodePoint(value, true)
  ) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must be a safe ICU message of at most ${npI18nContractLimits.messageLength.toString()} characters.`,
      ),
    );
    return null;
  }
  if (locale) {
    try {
      new IntlMessageFormat(value, locale);
    } catch (error) {
      issues.push(
        issue(
          "invalid-field",
          path,
          `is invalid ICU MessageFormat: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return null;
    }
  }
  return value;
}

export function npAnalyzeI18nConfig(
  value: unknown,
  options: { readonly path?: string } = {},
): NpI18nContractResult<NpI18nConfig> {
  const path = options.path ?? "i18n";
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, path, issues);
  if (!record) return fail(issues);
  pushUnknown(record, configKeys, path, issues);
  const locales = inspectArray(
    record.fields.locales,
    `${path}.locales`,
    npI18nContractLimits.catalogLocales,
    issues,
  );
  const normalized: string[] = [];
  const seen = new Map<string, number>();
  if (locales) {
    if (locales.length === 0) {
      issues.push(issue("shape", `${path}.locales`, "must contain at least one locale."));
    }
    for (const [index, candidate] of locales.entries()) {
      const previous = typeof candidate === "string" ? seen.get(candidate) : undefined;
      if (typeof candidate === "string") {
        if (previous !== undefined) {
          issues.push(
            issue(
              "duplicate",
              `${path}.locales.${index.toString()}`,
              `duplicate locale "${candidate}"; first declared at index ${previous.toString()}.`,
            ),
          );
        } else {
          seen.set(candidate, index);
        }
      }
      const locale = analyzeLocale(candidate, `${path}.locales.${index.toString()}`, issues);
      if (!locale) continue;
      if (previous === undefined) normalized.push(locale);
    }
  }
  const defaultLocale = analyzeLocale(record.fields.defaultLocale, `${path}.defaultLocale`, issues);
  if (defaultLocale && !seen.has(defaultLocale)) {
    issues.push(
      issue("invalid-field", `${path}.defaultLocale`, "must be one of the declared locales."),
    );
  }
  return issues.length > 0 || !defaultLocale
    ? fail(issues)
    : pass(
        Object.freeze({
          locales: Object.freeze(normalized),
          defaultLocale,
        }),
      );
}

export function npRequireI18nConfig(
  value: unknown,
  options: { readonly path?: string } = {},
): NpI18nConfig {
  return requireResult(npAnalyzeI18nConfig(value, options), "Invalid i18n config");
}

function analyzeBundle(
  locale: string,
  value: unknown,
  path: string,
  issues: NpI18nContractIssue[],
  allowEmpty: boolean,
): NpTranslationBundle | null {
  const record = inspectRecord(value, path, issues);
  if (!record) return null;
  if (!allowEmpty && record.keys.length === 0) {
    issues.push(issue("shape", path, "must contain at least one translation string."));
  }
  if (record.keys.length > npI18nContractLimits.bundleKeys) {
    issues.push(
      issue(
        "max-items",
        path,
        `may contain at most ${npI18nContractLimits.bundleKeys.toString()} strings.`,
      ),
    );
    return null;
  }
  const bundle: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of record.keys) {
    const validKey = analyzeKey(key, `${path}.${key}`, issues);
    const message = analyzeMessage(record.fields[key], locale, `${path}.${key}`, issues);
    if (validKey && message !== null) bundle[validKey] = message;
  }
  return Object.freeze(bundle);
}

export function npAnalyzeTranslationBundle(
  localeValue: unknown,
  value: unknown,
  options: { readonly path?: string; readonly allowEmpty?: boolean } = {},
): NpI18nContractResult<NpTranslationBundle> {
  const issues: NpI18nContractIssue[] = [];
  const locale = analyzeLocale(localeValue, `${options.path ?? "bundle"}.locale`, issues);
  const bundle = locale
    ? analyzeBundle(locale, value, options.path ?? "bundle", issues, options.allowEmpty ?? false)
    : null;
  return issues.length > 0 || !bundle ? fail(issues) : pass(bundle);
}

export function npRequireTranslationBundle(
  locale: unknown,
  value: unknown,
  options: { readonly path?: string; readonly allowEmpty?: boolean } = {},
): NpTranslationBundle {
  return requireResult(
    npAnalyzeTranslationBundle(locale, value, options),
    "Invalid translation bundle",
  );
}

export function npAnalyzeTranslationCatalog(
  value: unknown,
  options: { readonly path?: string; readonly allowEmpty?: boolean } = {},
): NpI18nContractResult<NpTranslationCatalog> {
  const path = options.path ?? "i18n";
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, path, issues);
  if (!record) return fail(issues);
  if (!options.allowEmpty && record.keys.length === 0) {
    issues.push(issue("shape", path, "must contain at least one locale."));
  }
  if (record.keys.length > npI18nContractLimits.catalogLocales) {
    issues.push(
      issue(
        "max-items",
        path,
        `may contain at most ${npI18nContractLimits.catalogLocales.toString()} locales.`,
      ),
    );
    return fail(issues);
  }
  const catalog: Record<string, NpTranslationBundle> = Object.create(null) as Record<
    string,
    NpTranslationBundle
  >;
  for (const rawLocale of record.keys) {
    const locale = analyzeLocale(rawLocale, `${path}.${rawLocale}`, issues);
    if (!locale) continue;
    const bundle = analyzeBundle(
      locale,
      record.fields[rawLocale],
      `${path}.${rawLocale}`,
      issues,
      false,
    );
    if (bundle) catalog[locale] = bundle;
  }
  return issues.length > 0 ? fail(issues) : pass(Object.freeze(catalog));
}

export function npRequireTranslationCatalog(
  value: unknown,
  options: { readonly path?: string; readonly allowEmpty?: boolean } = {},
): NpTranslationCatalog {
  return requireResult(npAnalyzeTranslationCatalog(value, options), "Invalid translation catalog");
}

export function npRequireTranslationKey(value: unknown, path = "key"): string {
  const issues: NpI18nContractIssue[] = [];
  const key = analyzeKey(value, path, issues);
  if (!key) throw new NpI18nContractError("Invalid translation key", issues);
  return key;
}

export function npRequireLocale(value: unknown, path = "locale"): string {
  const issues: NpI18nContractIssue[] = [];
  const locale = analyzeLocale(value, path, issues);
  if (!locale) throw new NpI18nContractError("Invalid locale", issues);
  return locale;
}

export function npRequireTranslationParams(value: unknown): NpTranslationParams | undefined {
  if (value === undefined) return undefined;
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, "params", issues);
  if (!record) throw new NpI18nContractError("Invalid translation params", issues);
  if (record.keys.length > npI18nContractLimits.translationParams) {
    issues.push(
      issue(
        "max-items",
        "params",
        `may contain at most ${npI18nContractLimits.translationParams.toString()} values.`,
      ),
    );
    throw new NpI18nContractError("Invalid translation params", issues);
  }
  const result: Record<string, string | number | boolean | Date | null | undefined> = Object.create(
    null,
  ) as Record<string, string | number | boolean | Date | null | undefined>;
  for (const key of record.keys) {
    if (
      key.length === 0 ||
      key.length > npI18nContractLimits.translationParamKeyLength ||
      key.trim() !== key ||
      !isWellFormedUnicode(key) ||
      hasUnsafeCodePoint(key, false)
    ) {
      issues.push(issue("invalid-field", `params.${key}`, "parameter name is invalid."));
      continue;
    }
    const candidate = record.fields[key];
    if (candidate instanceof Date) {
      if (Number.isNaN(candidate.getTime())) {
        issues.push(issue("invalid-field", `params.${key}`, "date parameter must be valid."));
      } else {
        result[key] = Object.freeze(new Date(candidate.getTime()));
      }
    } else if (
      candidate === null ||
      candidate === undefined ||
      typeof candidate === "boolean" ||
      (typeof candidate === "number" && Number.isFinite(candidate)) ||
      (typeof candidate === "string" &&
        candidate.length <= npI18nContractLimits.translationParamStringLength &&
        isWellFormedUnicode(candidate) &&
        !hasUnsafeCodePoint(candidate, true))
    ) {
      result[key] = candidate;
    } else {
      issues.push(
        issue(
          "invalid-field",
          `params.${key}`,
          "must be a finite number, safe string, boolean, valid Date, null, or undefined.",
        ),
      );
    }
  }
  if (issues.length > 0) throw new NpI18nContractError("Invalid translation params", issues);
  return Object.freeze(result);
}

export function npAnalyzeResolveLocaleInput(
  value: unknown,
): NpI18nContractResult<NpResolveLocaleInput> {
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, "localeInput", issues);
  if (!record) return fail(issues);
  pushUnknown(record, resolveInputKeys, "localeInput", issues);
  const pathname = record.fields.pathname;
  const acceptLanguage = record.fields.acceptLanguage;
  if (
    pathname !== undefined &&
    (typeof pathname !== "string" ||
      pathname.length > npI18nContractLimits.pathnameLength ||
      !pathname.startsWith("/") ||
      !isWellFormedUnicode(pathname) ||
      hasUnsafeCodePoint(pathname, false))
  ) {
    issues.push(
      issue(
        "invalid-field",
        "localeInput.pathname",
        `must be an absolute safe pathname of at most ${npI18nContractLimits.pathnameLength.toString()} characters.`,
      ),
    );
  }
  if (
    acceptLanguage !== undefined &&
    (typeof acceptLanguage !== "string" ||
      acceptLanguage.length > npI18nContractLimits.acceptLanguageLength ||
      !isWellFormedUnicode(acceptLanguage) ||
      hasUnsafeCodePoint(acceptLanguage, false))
  ) {
    issues.push(
      issue(
        "invalid-field",
        "localeInput.acceptLanguage",
        `must be a safe header of at most ${npI18nContractLimits.acceptLanguageLength.toString()} characters.`,
      ),
    );
  }
  if (
    typeof acceptLanguage === "string" &&
    acceptLanguage.split(",").length > npI18nContractLimits.acceptLanguageEntries
  ) {
    issues.push(
      issue(
        "max-items",
        "localeInput.acceptLanguage",
        `may contain at most ${npI18nContractLimits.acceptLanguageEntries.toString()} ranges.`,
      ),
    );
  }
  return issues.length > 0
    ? fail(issues)
    : pass(
        Object.freeze({
          ...(typeof pathname === "string" ? { pathname } : {}),
          ...(typeof acceptLanguage === "string" ? { acceptLanguage } : {}),
        }),
      );
}

export function npRequireResolveLocaleInput(value: unknown): NpResolveLocaleInput {
  return requireResult(npAnalyzeResolveLocaleInput(value), "Invalid locale resolution input");
}

function analyzeMutation(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  requireValue: boolean,
): NpI18nContractResult<NpStringOverrideMutation | NpStringOverrideDeleteQuery> {
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, path, issues);
  if (!record) return fail(issues);
  pushUnknown(record, allowed, path, issues);
  const locale = analyzeLocale(record.fields.locale, `${path}.locale`, issues);
  const key = analyzeKey(record.fields.key, `${path}.key`, issues);
  const rawValue = record.fields.value;
  let message: string | null = null;
  if (requireValue) {
    if (rawValue === null) {
      message = null;
    } else {
      message = analyzeMessage(rawValue, locale, `${path}.value`, issues);
    }
  }
  if (issues.length > 0 || !locale || !key) return fail(issues);
  return pass(
    requireValue ? Object.freeze({ locale, key, value: message }) : Object.freeze({ locale, key }),
  );
}

export function npAnalyzeStringOverrideMutation(
  value: unknown,
): NpI18nContractResult<NpStringOverrideMutation> {
  return analyzeMutation(
    value,
    mutationKeys,
    "override",
    true,
  ) as NpI18nContractResult<NpStringOverrideMutation>;
}

export function npRequireStringOverrideMutation(value: unknown): NpStringOverrideMutation {
  return requireResult(npAnalyzeStringOverrideMutation(value), "Invalid string override");
}

export function npAnalyzeStringOverrideDeleteQuery(
  value: unknown,
): NpI18nContractResult<NpStringOverrideDeleteQuery> {
  return analyzeMutation(value, deleteQueryKeys, "query", false);
}

export function npRequireStringOverrideDeleteQuery(value: unknown): NpStringOverrideDeleteQuery {
  return requireResult(npAnalyzeStringOverrideDeleteQuery(value), "Invalid string override query");
}

export function npAnalyzeStringOverrideRow(
  value: unknown,
  options: { readonly config?: unknown } = {},
): NpI18nContractResult<NpStringOverrideRow> {
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, "overrideRow", issues);
  if (!record) return fail(issues);
  pushUnknown(record, overrideRowKeys, "overrideRow", issues);
  const siteId = record.fields.siteId;
  if (!npIsCanonicalSiteId(siteId)) {
    issues.push(issue("invalid-field", "overrideRow.siteId", "must be a canonical site id."));
  }
  const locale = analyzeLocale(record.fields.locale, "overrideRow.locale", issues);
  if (locale && options.config !== undefined) {
    const config = npAnalyzeI18nConfig(options.config);
    if (!config.ok) {
      issues.push(...config.issues);
    } else if (!config.value.locales.includes(locale)) {
      issues.push(
        issue(
          "invalid-field",
          "overrideRow.locale",
          `locale "${locale}" is not configured for this runtime.`,
        ),
      );
    }
  }
  const key = analyzeKey(record.fields.key, "overrideRow.key", issues);
  const rawValue = record.fields.value;
  const message =
    rawValue === null ? null : analyzeMessage(rawValue, locale, "overrideRow.value", issues);
  const updatedAt = record.fields.updatedAt;
  if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
    issues.push(issue("invalid-field", "overrideRow.updatedAt", "must be a valid Date."));
  }
  const updatedBy = record.fields.updatedBy;
  if (updatedBy !== null && (typeof updatedBy !== "string" || !uuidPattern.test(updatedBy))) {
    issues.push(
      issue("invalid-field", "overrideRow.updatedBy", "must be a canonical UUID or null."),
    );
  }
  return issues.length > 0 || typeof siteId !== "string" || !locale || !key
    ? fail(issues)
    : pass(
        Object.freeze({
          siteId,
          locale,
          key,
          value: message,
          updatedAt: Object.freeze(new Date((updatedAt as Date).getTime())),
          updatedBy: updatedBy as string | null,
        }),
      );
}

export function npRequireStringOverrideRow(
  value: unknown,
  options: { readonly config?: unknown } = {},
): NpStringOverrideRow {
  return requireResult(
    npAnalyzeStringOverrideRow(value, options),
    "Invalid persisted string override",
  );
}

export function npCreateStringOverrideCatalog(rowsValue: unknown): NpStringOverrideCatalog {
  const issues: NpI18nContractIssue[] = [];
  const rawRows = inspectArray(rowsValue, "overrideRows", npI18nContractLimits.adminRows, issues);
  if (!rawRows || issues.length > 0) {
    throw new NpI18nContractError("Invalid string override rows", issues);
  }
  const rows = rawRows.map((row) => npRequireStringOverrideRow(row));
  const mutable: Record<string, Record<string, string | null>> = Object.create(null) as Record<
    string,
    Record<string, string | null>
  >;
  const seen = new Set<string>();
  for (const row of rows) {
    const identity = `${row.locale}\u0000${row.key}`;
    if (seen.has(identity)) {
      issues.push(
        issue(
          "duplicate",
          "overrideRows",
          `duplicate override for locale "${row.locale}" and key "${row.key}".`,
        ),
      );
      continue;
    }
    seen.add(identity);
    const bundle = mutable[row.locale] ?? (Object.create(null) as Record<string, string | null>);
    bundle[row.key] = row.value;
    mutable[row.locale] = bundle;
  }
  if (issues.length > 0) throw new NpI18nContractError("Invalid string override rows", issues);
  for (const bundle of Object.values(mutable)) Object.freeze(bundle);
  return Object.freeze(mutable);
}

export function npAnalyzeI18nConfigResponse(
  value: unknown,
): NpI18nContractResult<NpI18nConfigResponse> {
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, "response", issues);
  if (!record) return fail(issues);
  if (record.fields.enabled === false) {
    pushUnknown(record, configDisabledKeys, "response", issues);
    return issues.length > 0 ? fail(issues) : pass(Object.freeze({ enabled: false }));
  }
  if (record.fields.enabled !== true) {
    issues.push(issue("invalid-field", "response.enabled", "must be a boolean discriminator."));
    return fail(issues);
  }
  pushUnknown(record, configEnabledKeys, "response", issues);
  const config = npAnalyzeI18nConfig(
    {
      locales: record.fields.locales,
      defaultLocale: record.fields.defaultLocale,
    },
    { path: "response" },
  );
  if (!config.ok) issues.push(...config.issues);
  return issues.length > 0 || !config.ok
    ? fail(issues)
    : pass(
        Object.freeze({
          enabled: true,
          locales: config.value.locales,
          defaultLocale: config.value.defaultLocale,
        }),
      );
}

export function npRequireI18nConfigResponse(value: unknown): NpI18nConfigResponse {
  return requireResult(npAnalyzeI18nConfigResponse(value), "Invalid i18n config response");
}

function analyzeCell(
  value: unknown,
  locale: string,
  path: string,
  issues: NpI18nContractIssue[],
): NpI18nStringCell | null {
  const record = inspectRecord(value, path, issues);
  if (!record) return null;
  pushUnknown(record, stringCellKeys, path, issues);
  const parseNullableMessage = (candidate: unknown, field: string): string | null => {
    if (candidate === null) return null;
    return analyzeMessage(candidate, locale, `${path}.${field}`, issues);
  };
  const base = parseNullableMessage(record.fields.base, "base");
  const override = parseNullableMessage(record.fields.override, "override");
  return Object.freeze({ base, override });
}

export function npAnalyzeI18nStringsResponse(
  value: unknown,
): NpI18nContractResult<NpI18nStringsResponse> {
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, "response", issues);
  if (!record) return fail(issues);
  pushUnknown(record, stringsResponseKeys, "response", issues);
  const localesRaw = inspectArray(
    record.fields.locales,
    "response.locales",
    npI18nContractLimits.catalogLocales,
    issues,
  );
  const locales: string[] = [];
  const localeSet = new Set<string>();
  if (localesRaw?.length === 0) {
    issues.push(issue("shape", "response.locales", "must contain at least one locale."));
  }
  for (const [index, candidate] of (localesRaw ?? []).entries()) {
    const locale = analyzeLocale(candidate, `response.locales.${index.toString()}`, issues);
    if (!locale) continue;
    if (localeSet.has(locale)) {
      issues.push(issue("duplicate", `response.locales.${index.toString()}`, "duplicate locale."));
    } else {
      localeSet.add(locale);
      locales.push(locale);
    }
  }
  const defaultLocale = analyzeLocale(
    record.fields.defaultLocale,
    "response.defaultLocale",
    issues,
  );
  if (defaultLocale && !localeSet.has(defaultLocale)) {
    issues.push(
      issue("invalid-field", "response.defaultLocale", "must be one of response.locales."),
    );
  }
  if (!npIsCanonicalSiteId(record.fields.siteId)) {
    issues.push(issue("invalid-field", "response.siteId", "must be a canonical site id."));
  }
  const rawRows = inspectArray(
    record.fields.keys,
    "response.keys",
    npI18nContractLimits.adminRows,
    issues,
  );
  const rows: NpI18nStringRow[] = [];
  const seenKeys = new Set<string>();
  for (const [index, rawRow] of (rawRows ?? []).entries()) {
    const path = `response.keys.${index.toString()}`;
    const row = inspectRecord(rawRow, path, issues);
    if (!row) continue;
    pushUnknown(row, stringRowKeys, path, issues);
    const key = analyzeKey(row.fields.key, `${path}.key`, issues);
    if (key && seenKeys.has(key)) {
      issues.push(issue("duplicate", `${path}.key`, `duplicate translation key "${key}".`));
    }
    if (key) seenKeys.add(key);
    const values = inspectRecord(row.fields.values, `${path}.values`, issues);
    const cells: Record<string, NpI18nStringCell> = Object.create(null) as Record<
      string,
      NpI18nStringCell
    >;
    if (values) {
      for (const valueLocale of values.keys) {
        if (!localeSet.has(valueLocale)) {
          issues.push(
            issue(
              "unknown-field",
              `${path}.values.${valueLocale}`,
              `locale "${valueLocale}" is not declared in response.locales.`,
            ),
          );
          continue;
        }
        const cell = analyzeCell(
          values.fields[valueLocale],
          valueLocale,
          `${path}.values.${valueLocale}`,
          issues,
        );
        if (cell) cells[valueLocale] = cell;
      }
      for (const locale of locales) {
        if (!Object.hasOwn(cells, locale)) {
          issues.push(
            issue("invalid-field", `${path}.values.${locale}`, "missing locale value cell."),
          );
        }
      }
    }
    if (key) rows.push(Object.freeze({ key, values: Object.freeze(cells) }));
  }
  return issues.length > 0 || typeof record.fields.siteId !== "string" || !defaultLocale
    ? fail(issues)
    : pass(
        Object.freeze({
          locales: Object.freeze(locales),
          defaultLocale,
          keys: Object.freeze(rows),
          siteId: record.fields.siteId,
        }),
      );
}

export function npRequireI18nStringsResponse(value: unknown): NpI18nStringsResponse {
  return requireResult(npAnalyzeI18nStringsResponse(value), "Invalid i18n strings response");
}

function analyzeProgressCount(
  value: unknown,
  path: string,
  issues: NpI18nContractIssue[],
): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(issue("invalid-field", path, "must be a non-negative safe integer."));
    return null;
  }
  return value;
}

export function npAnalyzeTranslationProgressResponse(
  value: unknown,
): NpI18nContractResult<NpTranslationProgressResponse> {
  if (value === null) return pass(null);
  const issues: NpI18nContractIssue[] = [];
  const record = inspectRecord(value, "response", issues);
  if (!record) return fail(issues);
  pushUnknown(record, progressKeys, "response", issues);

  const config = npAnalyzeI18nConfig(
    {
      locales: record.fields.locales,
      defaultLocale: record.fields.defaultLocale,
    },
    { path: "response" },
  );
  if (!config.ok) issues.push(...config.issues);
  const locales = config.ok ? config.value.locales : Object.freeze([] as string[]);
  const localeSet = new Set(locales);

  const rawCollections = inspectArray(
    record.fields.collections,
    "response.collections",
    npI18nContractLimits.progressCollections,
    issues,
  );
  const collections: NpCollectionTranslationProgress[] = [];
  const seenCollections = new Set<string>();
  for (const [index, rawCollection] of (rawCollections ?? []).entries()) {
    const path = `response.collections.${index.toString()}`;
    const collectionRecord = inspectRecord(rawCollection, path, issues);
    if (!collectionRecord) continue;
    pushUnknown(collectionRecord, progressCollectionKeys, path, issues);

    const collection = collectionRecord.fields.collection;
    const validCollection =
      typeof collection === "string" &&
      collection.length <= 63 &&
      collectionSlugPattern.test(collection);
    if (!validCollection) {
      issues.push(
        issue("invalid-field", `${path}.collection`, "must be a canonical collection slug."),
      );
    } else if (seenCollections.has(collection)) {
      issues.push(
        issue("duplicate", `${path}.collection`, `duplicate collection "${collection}".`),
      );
    } else {
      seenCollections.add(collection);
    }

    const totalGroups = analyzeProgressCount(
      collectionRecord.fields.totalGroups,
      `${path}.totalGroups`,
      issues,
    );
    const rawPerLocale = inspectRecord(
      collectionRecord.fields.perLocale,
      `${path}.perLocale`,
      issues,
    );
    const perLocale: Record<string, NpTranslationProgressLocaleStats> = Object.create(
      null,
    ) as Record<string, NpTranslationProgressLocaleStats>;
    if (rawPerLocale) {
      for (const locale of rawPerLocale.keys) {
        if (!localeSet.has(locale)) {
          issues.push(
            issue(
              "unknown-field",
              `${path}.perLocale.${locale}`,
              `locale "${locale}" is not declared in response.locales.`,
            ),
          );
          continue;
        }
        const statsRecord = inspectRecord(
          rawPerLocale.fields[locale],
          `${path}.perLocale.${locale}`,
          issues,
        );
        if (!statsRecord) continue;
        pushUnknown(statsRecord, progressLocaleKeys, `${path}.perLocale.${locale}`, issues);
        const count = analyzeProgressCount(
          statsRecord.fields.count,
          `${path}.perLocale.${locale}.count`,
          issues,
        );
        const missing = analyzeProgressCount(
          statsRecord.fields.missing,
          `${path}.perLocale.${locale}.missing`,
          issues,
        );
        if (count !== null && missing !== null && totalGroups !== null) {
          if (count > totalGroups || missing !== Math.max(0, totalGroups - count)) {
            issues.push(
              issue(
                "invalid-field",
                `${path}.perLocale.${locale}`,
                "count and missing must describe totalGroups exactly.",
              ),
            );
          }
          perLocale[locale] = Object.freeze({ count, missing });
        }
      }
      for (const locale of locales) {
        if (!Object.hasOwn(perLocale, locale)) {
          issues.push(
            issue("invalid-field", `${path}.perLocale.${locale}`, "missing locale progress."),
          );
        }
      }
    }

    if (validCollection && totalGroups !== null) {
      collections.push(
        Object.freeze({
          collection,
          totalGroups,
          perLocale: Object.freeze(perLocale),
        }),
      );
    }
  }

  return issues.length > 0 || !config.ok
    ? fail(issues)
    : pass(
        Object.freeze({
          defaultLocale: config.value.defaultLocale,
          locales: config.value.locales,
          collections: Object.freeze(collections),
        }) satisfies NpTranslationProgress,
      );
}

export function npRequireTranslationProgressResponse(
  value: unknown,
): NpTranslationProgressResponse {
  return requireResult(
    npAnalyzeTranslationProgressResponse(value),
    "Invalid translation progress response",
  );
}
