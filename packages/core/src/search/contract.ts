import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import {
  npSearchDocumentStatuses,
  npSearchVisibilities,
  type NpSearchAdapter,
  type NpSearchAdapterContext,
  type NpSearchAdapterResult,
  type NpSearchCollectionFacet,
  type NpSearchContractIssue,
  type NpSearchContractValidationResult,
  type NpSearchDocument,
  type NpSearchDocumentValue,
  type NpSearchReindexResult,
  type NpSearchReindexResponse,
  type NpSearchRequest,
  type NpSearchResult,
  type NpSearchResultDocument,
  type NpSearchResultItem,
  type NpSearchSiteId,
  type NpSearchVisibility,
} from "./types.js";

export const npSearchContractLimits = {
  adapterKindLength: 64,
  candidateRows: 50_000,
  collectionCount: 200,
  collectionsQueryLength: 12_799,
  collectionSlugLength: 63,
  documentArrayItems: 500,
  documentDepth: 16,
  documentKeyCount: 200,
  documentKeyLength: 128,
  documentNodes: 20_000,
  documentStringCharacters: 500_000,
  documentStringLength: 100_000,
  facetLabelLength: 200,
  limit: 50,
  localeLength: 63,
  offset: 10_000,
  queryLength: 256,
  resultDocumentIdLength: 200,
} as const;

export const npSearchCollectionSlugPattern = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
export const npSearchAdapterKindPattern = "^[a-z][a-z0-9-]{0,63}$";

const collectionSlugPattern = new RegExp(npSearchCollectionSlugPattern, "u");
const adapterKindPattern = new RegExp(npSearchAdapterKindPattern, "u");
const requestKeys = new Set([
  "q",
  "collections",
  "limit",
  "offset",
  "locale",
  "siteId",
  "visibility",
]);
const contextKeys = new Set(requestKeys);
const adapterKeys = new Set(["kind", "search", "shutdown"]);
const adapterResultKeys = new Set(["results", "total", "perCollection"]);
const resultKeys = new Set([...adapterResultKeys, "facets", "limit", "offset", "hasNextPage"]);
const itemKeys = new Set(["collection", "doc", "score"]);
const facetKeys = new Set(["collection", "label", "count", "selected"]);
const reindexResultKeys = new Set(["collection", "processed"]);
const reindexResponseKeys = new Set(["total", "collections"]);
const apiQueryKeys = new Set(["q", "collections", "limit", "page", "offset", "locale"]);
const reindexQueryKeys = new Set(["collection"]);
const documentStatuses = new Set<string>(npSearchDocumentStatuses);
const visibilitySet = new Set<string>(npSearchVisibilities);

interface Parsed<T> {
  readonly issues: NpSearchContractIssue[];
  readonly value: T | null;
}

interface InspectedRecord {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly keys: readonly string[];
}

interface JsonState {
  nodes: number;
  characters: number;
  readonly ancestors: Set<object>;
}

export class NpSearchContractError extends TypeError {
  readonly issues: readonly NpSearchContractIssue[];

  constructor(message: string, issues: readonly NpSearchContractIssue[]) {
    const first = issues[0];
    super(first ? `${message}: ${first.path}: ${first.message}` : message);
    this.name = "NpSearchContractError";
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(
  code: NpSearchContractIssue["code"],
  path: string,
  message: string,
): NpSearchContractIssue {
  return { code, path, message };
}

function fail<T>(issues: NpSearchContractIssue[]): Parsed<T> {
  return { issues, value: null };
}

function validationResult<T>(parsed: Parsed<T>): NpSearchContractValidationResult<T> {
  return parsed.issues.length === 0 && parsed.value !== null
    ? { ok: true, value: parsed.value, issues: Object.freeze([]) }
    : { ok: false, value: null, issues: Object.freeze(parsed.issues) };
}

function requireParsed<T>(parsed: Parsed<T>, message: string): T {
  if (parsed.issues.length > 0 || parsed.value === null) {
    throw new NpSearchContractError(message, parsed.issues);
  }
  return parsed.value;
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

function hasUnsafeTextCodePoint(value: string, allowLineBreaks: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 0 ||
      code === 0x7f ||
      code === 0xfffe ||
      code === 0xffff ||
      (code < 0x20 && (!allowLineBreaks || (code !== 0x09 && code !== 0x0a && code !== 0x0d)))
    ) {
      return true;
    }
  }
  return false;
}

function inspectRecord(
  value: unknown,
  path: string,
  issues: NpSearchContractIssue[],
): InspectedRecord | null {
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "search values must be inspectable plain objects."));
    return null;
  }
  if (typeof value !== "object" || value === null || arrayValue) {
    issues.push(issue("shape", path, "search values must be plain objects."));
    return null;
  }

  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    ownKeys = Reflect.ownKeys(value);
  } catch {
    issues.push(issue("shape", path, "search values must be inspectable plain objects."));
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    issues.push(issue("shape", path, "search values must be plain objects."));
    return null;
  }

  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const keys: string[] = [];
  for (const ownKey of ownKeys) {
    if (typeof ownKey !== "string") {
      issues.push(issue("unknown-field", path, "search values must not contain symbol keys."));
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    } catch {
      issues.push(issue("shape", `${path}.${ownKey}`, "search fields must be inspectable."));
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue(
          "shape",
          `${path}.${ownKey}`,
          "search fields must be enumerable data properties; accessors are not supported.",
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
  issues: NpSearchContractIssue[],
): readonly unknown[] | null {
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "search arrays must be inspectable."));
    return null;
  }
  if (!arrayValue) {
    issues.push(issue("shape", path, "must be an array."));
    return null;
  }
  const array = value as unknown[];

  let prototype: object | null;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(array) as object | null;
    lengthDescriptor = Object.getOwnPropertyDescriptor(array, "length");
  } catch {
    issues.push(issue("shape", path, "search arrays must be inspectable."));
    return null;
  }
  if (prototype !== Array.prototype) {
    issues.push(issue("shape", path, "search arrays must use the built-in Array prototype."));
    return null;
  }
  const rawLength =
    lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (typeof rawLength !== "number" || !Number.isSafeInteger(rawLength) || rawLength < 0) {
    issues.push(issue("shape", path, "search arrays must expose a valid data length."));
    return null;
  }
  if (rawLength > maximum) {
    issues.push(issue("max-items", path, `may contain at most ${maximum.toString()} items.`));
    return null;
  }

  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(array);
  } catch {
    issues.push(issue("shape", path, "search arrays must be inspectable."));
    return null;
  }
  for (const ownKey of ownKeys) {
    if (ownKey === "length") continue;
    const index = typeof ownKey === "string" ? Number(ownKey) : Number.NaN;
    if (
      typeof ownKey !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(ownKey) ||
      !Number.isSafeInteger(index) ||
      index >= rawLength
    ) {
      issues.push(
        issue("unknown-field", path, "search arrays must not contain custom properties."),
      );
      break;
    }
  }

  const result: unknown[] = new Array<unknown>(rawLength);
  for (let index = 0; index < rawLength; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array, index.toString());
    } catch {
      issues.push(issue("shape", `${path}.${index.toString()}`, "array item is not inspectable."));
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue("shape", `${path}.${index.toString()}`, "search arrays must be dense data arrays."),
      );
      continue;
    }
    result[index] = descriptor.value;
  }
  return result;
}

function pushUnknownFields(
  inspected: InspectedRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpSearchContractIssue[],
): void {
  for (const key of inspected.keys) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported search field "${key}".`));
    }
  }
}

function parseCollectionSlug(
  value: unknown,
  path: string,
  issues: NpSearchContractIssue[],
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npSearchContractLimits.collectionSlugLength ||
    !collectionSlugPattern.test(value)
  ) {
    issues.push(issue("invalid-field", path, "must be a canonical collection slug."));
    return null;
  }
  return value;
}

export function npRequireSearchCollectionSlug(value: unknown, path = "search.collection"): string {
  const issues: NpSearchContractIssue[] = [];
  const parsed = parseCollectionSlug(value, path, issues);
  if (!parsed || issues.length > 0)
    throw new NpSearchContractError("Invalid search collection", issues);
  return parsed;
}

function parseLocale(value: unknown, path: string, issues: NpSearchContractIssue[]): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npSearchContractLimits.localeLength
  ) {
    issues.push(issue("invalid-field", path, "must be a canonical BCP 47 locale."));
    return null;
  }
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(value)[0];
  } catch {
    canonical = undefined;
  }
  if (!canonical || canonical !== value) {
    issues.push(issue("invalid-field", path, "must be a canonical BCP 47 locale."));
    return null;
  }
  return value;
}

function parseQuery(value: unknown, path: string, issues: NpSearchContractIssue[]): string | null {
  if (typeof value !== "string") {
    issues.push(issue("invalid-field", path, "must be text."));
    return null;
  }
  if (value.length > npSearchContractLimits.queryLength) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `may contain at most ${npSearchContractLimits.queryLength.toString()} characters.`,
      ),
    );
    return null;
  }
  if (!isWellFormedUnicode(value) || hasUnsafeTextCodePoint(value, true)) {
    issues.push(
      issue("invalid-field", path, "must be well-formed text without control characters."),
    );
    return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized.length > npSearchContractLimits.queryLength) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `may contain at most ${npSearchContractLimits.queryLength.toString()} characters after normalization.`,
      ),
    );
    return null;
  }
  return normalized;
}

function parseCollections(
  value: unknown,
  path: string,
  issues: NpSearchContractIssue[],
): readonly string[] | undefined | null {
  if (value === undefined) return undefined;
  const entries = inspectArray(value, path, npSearchContractLimits.collectionCount, issues);
  if (!entries) return null;
  if (entries.length === 0) {
    issues.push(issue("invalid-field", path, "must be omitted instead of an empty array."));
    return null;
  }
  const seen = new Set<string>();
  const collections: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const slug = parseCollectionSlug(entry, `${path}.${index.toString()}`, issues);
    if (!slug) continue;
    if (seen.has(slug)) {
      issues.push(
        issue("duplicate", `${path}.${index.toString()}`, `duplicate collection "${slug}".`),
      );
      continue;
    }
    seen.add(slug);
    collections.push(slug);
  }
  return Object.freeze(collections);
}

function parseInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  fallback: number,
  issues: NpSearchContractIssue[],
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must be a safe integer from ${minimum.toString()} through ${maximum.toString()}.`,
      ),
    );
    return fallback;
  }
  return value as number;
}

function parseSiteId(
  value: unknown,
  path: string,
  required: boolean,
  issues: NpSearchContractIssue[],
): NpSearchSiteId | undefined | null {
  if (value === undefined && !required) return undefined;
  if (value === "*" || npIsCanonicalSiteId(value)) return value;
  issues.push(
    issue("invalid-field", path, 'must be a canonical site id or the trusted "*" sentinel.'),
  );
  return null;
}

function parseVisibility(
  value: unknown,
  path: string,
  issues: NpSearchContractIssue[],
): NpSearchVisibility {
  if (value === undefined) return "public";
  if (typeof value === "string" && visibilitySet.has(value)) return value as NpSearchVisibility;
  issues.push(issue("invalid-field", path, 'must be exactly "public" or "all".'));
  return "public";
}

function parseRequest(value: unknown, path: string, requireSite: boolean): Parsed<NpSearchRequest> {
  const issues: NpSearchContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, requireSite ? contextKeys : requestKeys, path, issues);
  const q = parseQuery(inspected.fields.q, `${path}.q`, issues);
  const collections = parseCollections(inspected.fields.collections, `${path}.collections`, issues);
  const limit = parseInteger(
    inspected.fields.limit,
    `${path}.limit`,
    1,
    npSearchContractLimits.limit,
    10,
    issues,
  );
  const offset = parseInteger(
    inspected.fields.offset,
    `${path}.offset`,
    0,
    npSearchContractLimits.offset,
    0,
    issues,
  );
  const locale =
    inspected.fields.locale === undefined
      ? undefined
      : parseLocale(inspected.fields.locale, `${path}.locale`, issues);
  const siteId = parseSiteId(inspected.fields.siteId, `${path}.siteId`, requireSite, issues);
  const visibility = parseVisibility(inspected.fields.visibility, `${path}.visibility`, issues);
  if (
    issues.length > 0 ||
    q === null ||
    collections === null ||
    locale === null ||
    siteId === null
  ) {
    return fail(issues);
  }
  const result: NpSearchRequest = {
    q,
    ...(collections ? { collections } : {}),
    limit,
    offset,
    ...(locale ? { locale } : {}),
    ...(siteId ? { siteId } : {}),
    visibility,
  };
  return { issues, value: Object.freeze(result) };
}

export function npAnalyzeSearchRequest(
  value: unknown,
  path = "search.request",
): NpSearchContractValidationResult<NpSearchRequest> {
  return validationResult(parseRequest(value, path, false));
}

export function npRequireSearchRequest(value: unknown, path = "search.request"): NpSearchRequest {
  return requireParsed(parseRequest(value, path, false), "Invalid search request");
}

export function npAnalyzeSearchAdapterContext(
  value: unknown,
  path = "search.adapter.context",
): NpSearchContractValidationResult<NpSearchAdapterContext> {
  const parsed = parseRequest(value, path, true);
  if (parsed.value?.siteId === undefined) return validationResult(fail(parsed.issues));
  return validationResult({
    issues: parsed.issues,
    value: parsed.value as NpSearchAdapterContext,
  });
}

export function npRequireSearchAdapterContext(
  value: unknown,
  path = "search.adapter.context",
): NpSearchAdapterContext {
  const parsed = parseRequest(value, path, true);
  if (parsed.value?.siteId === undefined) {
    parsed.issues.push(issue("invalid-field", `${path}.siteId`, "is required."));
  }
  return requireParsed(
    { issues: parsed.issues, value: parsed.value as NpSearchAdapterContext | null },
    "Invalid search adapter context",
  );
}

function parseAdapter(value: unknown, path: string): Parsed<NpSearchAdapter> {
  const issues: NpSearchContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, adapterKeys, path, issues);
  const kind = inspected.fields.kind;
  const search = inspected.fields.search;
  const shutdown = inspected.fields.shutdown;
  if (
    typeof kind !== "string" ||
    kind.length > npSearchContractLimits.adapterKindLength ||
    !adapterKindPattern.test(kind)
  ) {
    issues.push(issue("invalid-field", `${path}.kind`, "must be a canonical adapter kind."));
  }
  if (typeof search !== "function") {
    issues.push(issue("invalid-field", `${path}.search`, "must be a function."));
  }
  if (shutdown !== undefined && typeof shutdown !== "function") {
    issues.push(issue("invalid-field", `${path}.shutdown`, "must be a function when provided."));
  }
  if (issues.length > 0 || typeof kind !== "string" || typeof search !== "function")
    return fail(issues);
  return {
    issues,
    value: Object.freeze({
      kind,
      search: search as NpSearchAdapter["search"],
      ...(typeof shutdown === "function"
        ? { shutdown: shutdown as NonNullable<NpSearchAdapter["shutdown"]> }
        : {}),
    }),
  };
}

export function npAnalyzeSearchAdapter(
  value: unknown,
  path = "search.adapter",
): NpSearchContractValidationResult<NpSearchAdapter> {
  return validationResult(parseAdapter(value, path));
}

export function npRequireSearchAdapter(value: unknown, path = "search.adapter"): NpSearchAdapter {
  return requireParsed(parseAdapter(value, path), "Invalid search adapter");
}

function parseJsonValue(
  value: unknown,
  path: string,
  depth: number,
  state: JsonState,
  issues: NpSearchContractIssue[],
): NpSearchDocumentValue | null {
  state.nodes += 1;
  if (state.nodes > npSearchContractLimits.documentNodes) {
    issues.push(issue("max-items", path, "search documents contain too many nested values."));
    return null;
  }
  if (depth > npSearchContractLimits.documentDepth) {
    issues.push(issue("invalid-field", path, "search documents are nested too deeply."));
    return null;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.push(issue("invalid-field", path, "search document numbers must be finite."));
      return null;
    }
    return value;
  }
  if (typeof value === "string") {
    if (
      value.length > npSearchContractLimits.documentStringLength ||
      !isWellFormedUnicode(value) ||
      hasUnsafeTextCodePoint(value, true)
    ) {
      issues.push(
        issue("invalid-field", path, "search document strings must be bounded well-formed text."),
      );
      return null;
    }
    state.characters += value.length;
    if (state.characters > npSearchContractLimits.documentStringCharacters) {
      issues.push(
        issue("max-items", path, "search document text exceeds the aggregate character limit."),
      );
      return null;
    }
    return value;
  }
  if (typeof value !== "object" || value === null) {
    issues.push(
      issue("shape", path, "search documents must contain only JSON values or valid Date values."),
    );
    return null;
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    issues.push(issue("shape", path, "search document values must be inspectable."));
    return null;
  }
  if (prototype === Date.prototype) {
    let ownKeys: readonly PropertyKey[];
    try {
      ownKeys = Reflect.ownKeys(value);
    } catch {
      issues.push(issue("shape", path, "search document dates must be inspectable."));
      return null;
    }
    if (ownKeys.length > 0) {
      issues.push(issue("shape", path, "search document dates must not have custom properties."));
      return null;
    }
    let timestamp: number;
    try {
      timestamp = Date.prototype.getTime.call(value);
    } catch {
      timestamp = Number.NaN;
    }
    if (!Number.isFinite(timestamp)) {
      issues.push(issue("invalid-field", path, "search document dates must be valid."));
      return null;
    }
    const result = new Date(timestamp).toISOString();
    state.characters += result.length;
    if (state.characters > npSearchContractLimits.documentStringCharacters) {
      issues.push(
        issue("max-items", path, "search document text exceeds the aggregate character limit."),
      );
      return null;
    }
    return result;
  }

  if (state.ancestors.has(value)) {
    issues.push(issue("shape", path, "search documents must not contain cycles."));
    return null;
  }
  state.ancestors.add(value);
  try {
    let arrayValue: boolean;
    try {
      arrayValue = Array.isArray(value);
    } catch {
      issues.push(issue("shape", path, "search document values must be inspectable."));
      return null;
    }
    if (arrayValue) {
      const entries = inspectArray(value, path, npSearchContractLimits.documentArrayItems, issues);
      if (!entries) return null;
      const output: NpSearchDocumentValue[] = [];
      for (const [index, entry] of entries.entries()) {
        const parsed = parseJsonValue(
          entry,
          `${path}.${index.toString()}`,
          depth + 1,
          state,
          issues,
        );
        if (parsed !== null || entry === null) output.push(parsed);
      }
      return Object.freeze(output);
    }

    const inspected = inspectRecord(value, path, issues);
    if (!inspected) return null;
    if (inspected.keys.length > npSearchContractLimits.documentKeyCount) {
      issues.push(
        issue(
          "max-items",
          path,
          `search document objects may contain at most ${npSearchContractLimits.documentKeyCount.toString()} keys.`,
        ),
      );
      return null;
    }
    const output: Record<string, NpSearchDocumentValue> = Object.create(null) as Record<
      string,
      NpSearchDocumentValue
    >;
    for (const key of inspected.keys) {
      if (
        key.length === 0 ||
        key.length > npSearchContractLimits.documentKeyLength ||
        !isWellFormedUnicode(key) ||
        hasUnsafeTextCodePoint(key, false)
      ) {
        issues.push(
          issue("invalid-field", `${path}.${key}`, "search document keys must be bounded text."),
        );
        continue;
      }
      const entry = inspected.fields[key];
      const parsed = parseJsonValue(entry, `${path}.${key}`, depth + 1, state, issues);
      if (parsed !== null || entry === null) output[key] = parsed;
    }
    return Object.freeze(output);
  } finally {
    state.ancestors.delete(value);
  }
}

function parseDocument(
  value: unknown,
  path: string,
  issues: NpSearchContractIssue[],
): NpSearchDocument | null {
  const state: JsonState = { nodes: 0, characters: 0, ancestors: new Set() };
  const parsed = parseJsonValue(value, path, 0, state, issues);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    if (parsed !== null)
      issues.push(issue("shape", path, "search result documents must be plain objects."));
    return null;
  }
  return parsed as NpSearchDocument;
}

function parseResultItem(
  value: unknown,
  path: string,
  context: NpSearchAdapterContext,
  allowedCollections: ReadonlySet<string>,
  issues: NpSearchContractIssue[],
): NpSearchResultItem | null {
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, itemKeys, path, issues);
  const collection = parseCollectionSlug(inspected.fields.collection, `${path}.collection`, issues);
  if (collection && !allowedCollections.has(collection)) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.collection`,
        `collection "${collection}" is not searchable in this request.`,
      ),
    );
  }
  const doc = parseDocument(inspected.fields.doc, `${path}.doc`, issues);
  const score = inspected.fields.score;
  if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) {
    issues.push(issue("invalid-field", `${path}.score`, "search scores must be finite numbers."));
  }
  if (doc) {
    const id = doc.id;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > npSearchContractLimits.resultDocumentIdLength ||
      id !== id.trim() ||
      !isWellFormedUnicode(id) ||
      hasUnsafeTextCodePoint(id, false)
    ) {
      issues.push(
        issue("invalid-field", `${path}.doc.id`, "must be a bounded stable document id."),
      );
    }
    if (!npIsCanonicalSiteId(doc.siteId)) {
      issues.push(issue("invalid-field", `${path}.doc.siteId`, "must be a canonical site id."));
    } else if (context.siteId !== "*" && doc.siteId !== context.siteId) {
      issues.push(issue("invariant", `${path}.doc.siteId`, "must match the search site scope."));
    }
    if (typeof doc.status !== "string" || !documentStatuses.has(doc.status)) {
      issues.push(
        issue("invalid-field", `${path}.doc.status`, "must be a canonical document status."),
      );
    }
    if (doc.visibility !== "public" && doc.visibility !== "private") {
      issues.push(issue("invalid-field", `${path}.doc.visibility`, "must be public or private."));
    }
    if (context.visibility === "public") {
      if (doc.status !== "published") {
        issues.push(
          issue("invariant", `${path}.doc.status`, "public search results must be published."),
        );
      }
      if (doc.visibility !== "public") {
        issues.push(
          issue("invariant", `${path}.doc.visibility`, "public search results must be public."),
        );
      }
    }
    if (context.locale && doc.locale !== undefined) {
      if (typeof doc.locale !== "string") {
        issues.push(
          issue("invalid-field", `${path}.doc.locale`, "must be a canonical locale string."),
        );
      } else if (doc.locale !== context.locale) {
        issues.push(
          issue("invariant", `${path}.doc.locale`, "must match the search locale when present."),
        );
      }
    }
  }
  if (
    issues.length > 0 ||
    !collection ||
    !allowedCollections.has(collection) ||
    !doc ||
    (score !== undefined && typeof score !== "number")
  ) {
    return null;
  }
  return Object.freeze({
    collection,
    doc: doc as NpSearchResultDocument,
    ...(typeof score === "number" ? { score } : {}),
  });
}

function parseCountRecord(
  value: unknown,
  path: string,
  allowedCollections: ReadonlySet<string>,
  issues: NpSearchContractIssue[],
): Readonly<Record<string, number>> | null {
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  if (inspected.keys.length > npSearchContractLimits.collectionCount) {
    issues.push(issue("max-items", path, "contains too many collection counts."));
    return null;
  }
  const output: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const key of inspected.keys) {
    const slug = parseCollectionSlug(key, `${path}.${key}`, issues);
    if (slug && !allowedCollections.has(slug)) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.${key}`,
          `collection "${slug}" is not searchable in this request.`,
        ),
      );
    }
    const count = inspected.fields[key];
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      issues.push(issue("invalid-field", `${path}.${key}`, "must be a non-negative safe integer."));
      continue;
    }
    if (slug && allowedCollections.has(slug)) output[slug] = count as number;
  }
  return Object.freeze(output);
}

function parseAdapterResult(
  value: unknown,
  context: NpSearchAdapterContext,
  knownCollections: ReadonlySet<string>,
  path: string,
): Parsed<NpSearchAdapterResult> {
  const issues: NpSearchContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, adapterResultKeys, path, issues);
  for (const collection of context.collections ?? []) {
    if (!knownCollections.has(collection)) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.perCollection.${collection}`,
          `requested collection "${collection}" is not in the searchable catalog.`,
        ),
      );
    }
  }
  const allowedCollections = context.collections
    ? new Set(context.collections.filter((slug) => knownCollections.has(slug)))
    : knownCollections;
  const rawResults = inspectArray(
    inspected.fields.results,
    `${path}.results`,
    context.limit,
    issues,
  );
  const results: NpSearchResultItem[] = [];
  const seenDocuments = new Set<string>();
  if (rawResults) {
    for (const [index, entry] of rawResults.entries()) {
      const result = parseResultItem(
        entry,
        `${path}.results.${index.toString()}`,
        context,
        allowedCollections,
        issues,
      );
      if (!result) continue;
      const key = `${result.collection}:${String(result.doc.id)}`;
      if (seenDocuments.has(key)) {
        issues.push(
          issue(
            "duplicate",
            `${path}.results.${index.toString()}`,
            `duplicate search result "${key}".`,
          ),
        );
      } else {
        seenDocuments.add(key);
        results.push(result);
      }
    }
  }
  const total = inspected.fields.total;
  if (!Number.isSafeInteger(total) || (total as number) < 0) {
    issues.push(issue("invalid-field", `${path}.total`, "must be a non-negative safe integer."));
  }
  const perCollection = parseCountRecord(
    inspected.fields.perCollection,
    `${path}.perCollection`,
    allowedCollections,
    issues,
  );
  if (perCollection) {
    for (const collection of allowedCollections) {
      if (!Object.hasOwn(perCollection, collection)) {
        issues.push(
          issue(
            "invariant",
            `${path}.perCollection.${collection}`,
            `must include a count for searchable collection "${collection}".`,
          ),
        );
      }
    }
    const sum = Object.values(perCollection).reduce((acc, count) => acc + count, 0);
    if (typeof total === "number" && sum !== total) {
      issues.push(
        issue("invariant", `${path}.perCollection`, "collection counts must sum to total."),
      );
    }
    for (const [index, result] of results.entries()) {
      if ((perCollection[result.collection] ?? 0) < 1) {
        issues.push(
          issue(
            "invariant",
            `${path}.results.${index.toString()}.collection`,
            "each result collection must have a positive collection count.",
          ),
        );
      }
    }
  }
  if (typeof total === "number" && results.length > 0 && context.offset + results.length > total) {
    issues.push(issue("invariant", `${path}.results`, "paged results must fit within total."));
  }
  if (typeof total === "number") {
    const expectedResultCount = Math.min(context.limit, Math.max(0, total - context.offset));
    if (results.length !== expectedResultCount) {
      issues.push(
        issue("invariant", `${path}.results`, "must contain the complete normalized result page."),
      );
    }
  }
  if (issues.length > 0 || !rawResults || typeof total !== "number" || !perCollection) {
    return fail(issues);
  }
  return {
    issues,
    value: Object.freeze({
      results: Object.freeze(results),
      total,
      perCollection,
    }),
  };
}

export function npAnalyzeSearchAdapterResult(
  value: unknown,
  context: NpSearchAdapterContext,
  knownCollections: ReadonlySet<string>,
  path = "search.adapter.result",
): NpSearchContractValidationResult<NpSearchAdapterResult> {
  const parsedContext = npRequireSearchAdapterContext(context);
  return validationResult(parseAdapterResult(value, parsedContext, knownCollections, path));
}

export function npRequireSearchAdapterResult(
  value: unknown,
  context: NpSearchAdapterContext,
  knownCollections: ReadonlySet<string>,
  path = "search.adapter.result",
): NpSearchAdapterResult {
  const parsedContext = npRequireSearchAdapterContext(context);
  return requireParsed(
    parseAdapterResult(value, parsedContext, knownCollections, path),
    "Invalid search adapter result",
  );
}

function collectionOrder(
  context: NpSearchAdapterContext,
  labels: Readonly<Record<string, string>>,
  perCollection: Readonly<Record<string, number>>,
): string[] {
  const candidates = context.collections ?? Object.keys(labels);
  return candidates.filter((slug) => Object.hasOwn(perCollection, slug));
}

function parseCollectionLabels(
  value: unknown,
  path: string,
): Parsed<Readonly<Record<string, string>>> {
  const issues: NpSearchContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  if (inspected.keys.length > npSearchContractLimits.collectionCount) {
    issues.push(issue("max-items", path, "contains too many search collection labels."));
  }
  const labels: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of inspected.keys) {
    const collection = parseCollectionSlug(key, `${path}.${key}`, issues);
    const label = inspected.fields[key];
    if (
      typeof label !== "string" ||
      label.length === 0 ||
      label.length > npSearchContractLimits.facetLabelLength ||
      label !== label.trim() ||
      !isWellFormedUnicode(label) ||
      hasUnsafeTextCodePoint(label, false)
    ) {
      issues.push(issue("invalid-field", `${path}.${key}`, "must be bounded display text."));
      continue;
    }
    if (collection) labels[collection] = label;
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(labels) };
}

function requireCollectionLabels(value: unknown): Readonly<Record<string, string>> {
  return requireParsed(
    parseCollectionLabels(value, "search.collectionLabels"),
    "Invalid search collection labels",
  );
}

export function npCreateSearchResult(
  value: unknown,
  context: NpSearchAdapterContext,
  collectionLabels: Readonly<Record<string, string>>,
): NpSearchResult {
  const parsedContext = npRequireSearchAdapterContext(context);
  const labels = requireCollectionLabels(collectionLabels);
  const knownCollections = new Set(Object.keys(labels));
  const parsed = npRequireSearchAdapterResult(value, parsedContext, knownCollections);
  const facets: NpSearchCollectionFacet[] = collectionOrder(
    parsedContext,
    labels,
    parsed.perCollection,
  ).map((collection) => {
    const label = labels[collection];
    return Object.freeze({
      collection,
      label,
      count: parsed.perCollection[collection] ?? 0,
      selected: true,
    });
  });
  return Object.freeze({
    ...parsed,
    facets: Object.freeze(facets),
    limit: parsedContext.limit,
    offset: parsedContext.offset,
    hasNextPage:
      parsedContext.offset + parsedContext.limit <= npSearchContractLimits.offset &&
      parsedContext.offset + parsed.results.length < parsed.total,
  });
}

function parseFacet(
  value: unknown,
  path: string,
  issues: NpSearchContractIssue[],
): NpSearchCollectionFacet | null {
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, facetKeys, path, issues);
  const collection = parseCollectionSlug(inspected.fields.collection, `${path}.collection`, issues);
  const label = inspected.fields.label;
  if (
    typeof label !== "string" ||
    label.length === 0 ||
    label.length > npSearchContractLimits.facetLabelLength ||
    label !== label.trim() ||
    !isWellFormedUnicode(label) ||
    hasUnsafeTextCodePoint(label, false)
  ) {
    issues.push(issue("invalid-field", `${path}.label`, "must be bounded display text."));
  }
  const count = inspected.fields.count;
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    issues.push(issue("invalid-field", `${path}.count`, "must be a non-negative safe integer."));
  }
  if (inspected.fields.selected !== true) {
    issues.push(issue("invariant", `${path}.selected`, "returned facets must be selected."));
  }
  if (!collection || typeof label !== "string" || typeof count !== "number") return null;
  return Object.freeze({ collection, label, count, selected: true });
}

function parseResult(
  value: unknown,
  context: NpSearchAdapterContext,
  collectionLabels: Readonly<Record<string, string>>,
  path: string,
): Parsed<NpSearchResult> {
  const issues: NpSearchContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, resultKeys, path, issues);
  const adapterParsed = parseAdapterResult(
    {
      results: inspected.fields.results,
      total: inspected.fields.total,
      perCollection: inspected.fields.perCollection,
    },
    context,
    new Set(Object.keys(collectionLabels)),
    path,
  );
  issues.push(...adapterParsed.issues);
  const rawFacets = inspectArray(
    inspected.fields.facets,
    `${path}.facets`,
    npSearchContractLimits.collectionCount,
    issues,
  );
  const facets: NpSearchCollectionFacet[] = [];
  if (rawFacets) {
    for (const [index, entry] of rawFacets.entries()) {
      const parsed = parseFacet(entry, `${path}.facets.${index.toString()}`, issues);
      if (parsed) facets.push(parsed);
    }
  }
  if (inspected.fields.limit !== context.limit) {
    issues.push(issue("invariant", `${path}.limit`, "must match the normalized request limit."));
  }
  if (inspected.fields.offset !== context.offset) {
    issues.push(issue("invariant", `${path}.offset`, "must match the normalized request offset."));
  }
  if (adapterParsed.value) {
    const expected = npCreateSearchResult(adapterParsed.value, context, collectionLabels);
    if (inspected.fields.hasNextPage !== expected.hasNextPage) {
      issues.push(
        issue("invariant", `${path}.hasNextPage`, "must match total, offset, and result count."),
      );
    }
    if (facets.length !== expected.facets.length) {
      issues.push(
        issue("invariant", `${path}.facets`, "must contain one framework-derived facet per count."),
      );
    } else {
      for (const [index, facet] of facets.entries()) {
        const wanted = expected.facets[index];
        if (
          !wanted ||
          facet.collection !== wanted.collection ||
          facet.label !== wanted.label ||
          facet.count !== wanted.count
        ) {
          issues.push(
            issue(
              "invariant",
              `${path}.facets.${index.toString()}`,
              "must match framework collection metadata.",
            ),
          );
        }
      }
    }
    if (issues.length === 0) return { issues, value: expected };
  }
  return fail(issues);
}

export function npAnalyzeSearchResult(
  value: unknown,
  context: NpSearchAdapterContext,
  collectionLabels: Readonly<Record<string, string>>,
  path = "search.result",
): NpSearchContractValidationResult<NpSearchResult> {
  const parsedContext = npRequireSearchAdapterContext(context);
  const labels = parseCollectionLabels(collectionLabels, "search.collectionLabels");
  return labels.value
    ? validationResult(parseResult(value, parsedContext, labels.value, path))
    : validationResult(fail(labels.issues));
}

export function npRequireSearchResult(
  value: unknown,
  context: NpSearchAdapterContext,
  collectionLabels: Readonly<Record<string, string>>,
  path = "search.result",
): NpSearchResult {
  const parsedContext = npRequireSearchAdapterContext(context);
  const labels = requireCollectionLabels(collectionLabels);
  return requireParsed(parseResult(value, parsedContext, labels, path), "Invalid search result");
}

export function npCreateEmptySearchResult(
  request: unknown,
  collectionLabels: Readonly<Record<string, string>> = Object.freeze({}),
): NpSearchResult {
  const parsed = npRequireSearchRequest(request);
  const labels = requireCollectionLabels(collectionLabels);
  for (const collection of parsed.collections ?? []) {
    if (!Object.hasOwn(labels, collection)) {
      throw new NpSearchContractError("Invalid empty search result", [
        issue(
          "invalid-field",
          `search.collectionLabels.${collection}`,
          `requested collection "${collection}" is not in the searchable catalog.`,
        ),
      ]);
    }
  }
  const collections = parsed.collections ?? Object.keys(labels);
  const perCollection = Object.freeze(
    Object.fromEntries(collections.map((collection) => [collection, 0])),
  );
  const facets = Object.freeze(
    collections.map((collection) =>
      Object.freeze({
        collection,
        label: labels[collection],
        count: 0,
        selected: true,
      }),
    ),
  );
  return Object.freeze({
    results: Object.freeze([]),
    total: 0,
    perCollection,
    facets,
    limit: parsed.limit,
    offset: parsed.offset,
    hasNextPage: false,
  });
}

function parseStrictIntegerQuery(
  value: string | null,
  path: string,
  minimum: number,
  maximum: number,
  fallback: number,
  issues: NpSearchContractIssue[],
): number {
  if (value === null) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    issues.push(issue("invalid-field", path, "must be a canonical base-10 integer."));
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must be from ${minimum.toString()} through ${maximum.toString()}.`,
      ),
    );
    return fallback;
  }
  return parsed;
}

function inspectQueryParams(
  params: URLSearchParams,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpSearchContractIssue[],
): void {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.has(key)) {
      issues.push(
        issue("unknown-field", `${path}.${key}`, `unsupported query parameter "${key}".`),
      );
      continue;
    }
    if (seen.has(key)) {
      issues.push(
        issue("duplicate", `${path}.${key}`, `query parameter "${key}" may appear only once.`),
      );
    }
    seen.add(key);
  }
}

export function npParseSearchApiQuery(params: URLSearchParams): NpSearchRequest {
  const issues: NpSearchContractIssue[] = [];
  inspectQueryParams(params, apiQueryKeys, "search.query", issues);
  if (!params.has("q")) {
    issues.push(issue("invalid-field", "search.query.q", "is required, even for an empty query."));
  }
  const rawCollections = params.get("collections");
  let collections: string[] | undefined;
  if (rawCollections !== null) {
    if (rawCollections.length > npSearchContractLimits.collectionsQueryLength) {
      issues.push(
        issue(
          "max-items",
          "search.query.collections",
          `may contain at most ${npSearchContractLimits.collectionsQueryLength.toString()} characters.`,
        ),
      );
    } else {
      const parts = rawCollections.split(",");
      if (parts.length > npSearchContractLimits.collectionCount) {
        issues.push(
          issue(
            "max-items",
            "search.query.collections",
            `may contain at most ${npSearchContractLimits.collectionCount.toString()} collection slugs.`,
          ),
        );
      } else if (parts.some((part) => part.length === 0 || part !== part.trim())) {
        issues.push(
          issue(
            "invalid-field",
            "search.query.collections",
            "must be canonical comma-separated slugs without empty or padded entries.",
          ),
        );
      } else {
        collections = parts;
      }
    }
  }
  const limit = parseStrictIntegerQuery(
    params.get("limit"),
    "search.query.limit",
    1,
    npSearchContractLimits.limit,
    10,
    issues,
  );
  if (params.has("page") && params.has("offset")) {
    issues.push(issue("invariant", "search.query", "page and offset are mutually exclusive."));
  }
  const page = parseStrictIntegerQuery(
    params.get("page"),
    "search.query.page",
    1,
    Math.floor(npSearchContractLimits.offset / limit) + 1,
    1,
    issues,
  );
  const offset = params.has("offset")
    ? parseStrictIntegerQuery(
        params.get("offset"),
        "search.query.offset",
        0,
        npSearchContractLimits.offset,
        0,
        issues,
      )
    : (page - 1) * limit;
  if (offset > npSearchContractLimits.offset) {
    issues.push(
      issue("invalid-field", "search.query.page", "computed offset exceeds the search limit."),
    );
  }
  if (issues.length > 0) throw new NpSearchContractError("Invalid search query", issues);
  return npRequireSearchRequest({
    q: params.get("q") ?? "",
    ...(collections ? { collections } : {}),
    limit,
    offset,
    ...(params.has("locale") ? { locale: params.get("locale") } : {}),
    visibility: "public",
  });
}

export function npParseSearchReindexQuery(params: URLSearchParams): string | null {
  const issues: NpSearchContractIssue[] = [];
  inspectQueryParams(params, reindexQueryKeys, "search.reindex.query", issues);
  const raw = params.get("collection");
  const collection =
    raw === null ? null : parseCollectionSlug(raw, "search.reindex.query.collection", issues);
  if (issues.length > 0) throw new NpSearchContractError("Invalid search reindex query", issues);
  return collection;
}

function parseReindexResult(value: unknown, path: string): Parsed<NpSearchReindexResult> {
  const issues: NpSearchContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, reindexResultKeys, path, issues);
  const collection = parseCollectionSlug(inspected.fields.collection, `${path}.collection`, issues);
  const processed = inspected.fields.processed;
  if (!Number.isSafeInteger(processed) || (processed as number) < 0) {
    issues.push(
      issue("invalid-field", `${path}.processed`, "must be a non-negative safe integer."),
    );
  }
  if (issues.length > 0 || !collection || typeof processed !== "number") return fail(issues);
  return { issues, value: Object.freeze({ collection, processed }) };
}

export function npAnalyzeSearchReindexResult(
  value: unknown,
  path = "search.reindex.result",
): NpSearchContractValidationResult<NpSearchReindexResult> {
  return validationResult(parseReindexResult(value, path));
}

export function npRequireSearchReindexResult(
  value: unknown,
  path = "search.reindex.result",
): NpSearchReindexResult {
  return requireParsed(parseReindexResult(value, path), "Invalid search reindex result");
}

function parseReindexResponse(value: unknown, path: string): Parsed<NpSearchReindexResponse> {
  const issues: NpSearchContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, reindexResponseKeys, path, issues);
  const rawCollections = inspectArray(
    inspected.fields.collections,
    `${path}.collections`,
    npSearchContractLimits.collectionCount,
    issues,
  );
  const collections: NpSearchReindexResult[] = [];
  const seen = new Set<string>();
  if (rawCollections) {
    for (const [index, entry] of rawCollections.entries()) {
      const parsed = parseReindexResult(entry, `${path}.collections.${index.toString()}`);
      issues.push(...parsed.issues);
      if (!parsed.value) continue;
      if (seen.has(parsed.value.collection)) {
        issues.push(
          issue(
            "duplicate",
            `${path}.collections.${index.toString()}.collection`,
            `duplicate reindex collection "${parsed.value.collection}".`,
          ),
        );
      } else {
        seen.add(parsed.value.collection);
        collections.push(parsed.value);
      }
    }
  }
  const total = inspected.fields.total;
  if (!Number.isSafeInteger(total) || (total as number) < 0) {
    issues.push(issue("invalid-field", `${path}.total`, "must be a non-negative safe integer."));
  } else {
    const sum = collections.reduce((value, entry) => value + entry.processed, 0);
    if (sum !== total) {
      issues.push(issue("invariant", `${path}.total`, "must equal the processed collection sum."));
    }
  }
  if (issues.length > 0 || !rawCollections || typeof total !== "number") return fail(issues);
  return {
    issues,
    value: Object.freeze({ total, collections: Object.freeze(collections) }),
  };
}

export function npAnalyzeSearchReindexResponse(
  value: unknown,
  path = "search.reindex.response",
): NpSearchContractValidationResult<NpSearchReindexResponse> {
  return validationResult(parseReindexResponse(value, path));
}

export function npRequireSearchReindexResponse(
  value: unknown,
  path = "search.reindex.response",
): NpSearchReindexResponse {
  return requireParsed(parseReindexResponse(value, path), "Invalid search reindex response");
}
