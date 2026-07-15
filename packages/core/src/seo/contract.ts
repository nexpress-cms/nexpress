import type {
  ArticleJsonLdInput,
  BuildAtomFeedOptions,
  BuildJsonLdContext,
  BuildSitemapOptions,
  NpFeedEntry,
  NpPageMetadataInput,
  NpSeoContractIssue,
  NpSeoContractValidationResult,
  NpSiteSeoSettings,
  NpSitemapAlternate,
  NpSitemapEntry,
  NpSitemapIndexEntry,
  PersonJsonLdInput,
} from "./types.js";
import { npSitemapChangeFrequencies } from "./types.js";

export const npSeoContractLimits = {
  maxSitemapEntries: 50_000,
  maxSitemapAlternates: 100,
  maxSitemapXmlBytes: 52_428_800,
  maxFeedEntries: 500,
  maxCollections: 200,
  maxCollectionLimit: 50_000,
  urlLength: 2_048,
  localeLength: 63,
  titleLength: 300,
  descriptionLength: 1_000,
  summaryLength: 4_000,
  authorLength: 200,
  siteNameLength: 200,
  robotsTxtLength: 500_000,
} as const;

const sitemapEntryKeys = new Set(["loc", "lastmod", "changefreq", "priority", "alternates"]);
const sitemapAlternateKeys = new Set(["hreflang", "href"]);
const sitemapIndexEntryKeys = new Set(["loc", "lastmod"]);
const feedEntryKeys = new Set(["id", "title", "summary", "link", "author", "updated", "published"]);
const sitemapOptionsKeys = new Set(["perCollectionLimit", "collections", "locale"]);
const atomOptionsKeys = new Set(["collection", "limit", "locale", "extraEntries"]);
const pageMetadataKeys = new Set([
  "title",
  "description",
  "ogImage",
  "path",
  "canonicalPath",
  "ogType",
  "publishedTime",
  "modifiedTime",
  "locale",
]);
const articleKeys = new Set([
  "url",
  "headline",
  "description",
  "image",
  "datePublished",
  "dateModified",
  "authorName",
  "type",
]);
const personKeys = new Set(["url", "name", "alternateName", "image", "description"]);
const jsonLdContextKeys = new Set(["origin"]);
const siteSettingsKeys = new Set([
  "siteName",
  "siteUrl",
  "defaultDescription",
  "defaultOgImage",
  "twitterHandle",
  "defaultLocale",
]);
const sitemapChangeFrequencySet = new Set<string>(npSitemapChangeFrequencies);
const collectionSlugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const twitterHandlePattern = /^[A-Za-z0-9_]{1,15}$/u;
const absoluteBase = "https://np-contract.invalid";

interface Parsed<T> {
  readonly issues: NpSeoContractIssue[];
  readonly value: T | null;
}

interface InspectedRecord {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly keys: readonly string[];
}

export class NpSeoContractError extends TypeError {
  readonly issues: readonly NpSeoContractIssue[];

  constructor(message: string, issues: readonly NpSeoContractIssue[]) {
    super(message);
    this.name = "NpSeoContractError";
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(
  code: NpSeoContractIssue["code"],
  path: string,
  message: string,
): NpSeoContractIssue {
  return { code, path, message };
}

function fail<T>(issues: NpSeoContractIssue[]): Parsed<T> {
  return { issues, value: null };
}

function throwContract(message: string, issues: readonly NpSeoContractIssue[]): never {
  const first = issues[0];
  throw new NpSeoContractError(
    first ? `${message}: ${first.path}: ${first.message}` : message,
    issues,
  );
}

function hasUnsafeTextCodePoint(value: string, allowLineBreaks: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 0xfffe ||
      code === 0xffff ||
      code === 0x7f ||
      code === 0 ||
      (code < 0x20 && (!allowLineBreaks || (code !== 0x09 && code !== 0x0a && code !== 0x0d)))
    ) {
      return true;
    }
  }
  return false;
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

function hasDotSegment(pathname: string): boolean {
  return pathname.split("/").some((segment) => {
    const decoded = decodeURIComponent(segment);
    return decoded === "." || decoded === "..";
  });
}

function inspectRecord(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): InspectedRecord | null {
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "SEO values must be inspectable plain objects."));
    return null;
  }
  if (typeof value !== "object" || value === null || arrayValue) {
    issues.push(issue("shape", path, "SEO values must be plain objects."));
    return null;
  }

  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    ownKeys = Reflect.ownKeys(value);
  } catch {
    issues.push(issue("shape", path, "SEO values must be inspectable plain objects."));
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    issues.push(issue("shape", path, "SEO values must be plain objects."));
    return null;
  }

  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const keys: string[] = [];
  for (const ownKey of ownKeys) {
    if (typeof ownKey !== "string") {
      issues.push(issue("unknown-field", path, "SEO values must not contain symbol keys."));
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    } catch {
      issues.push(
        issue("shape", `${path}.${ownKey}`, "SEO fields must be inspectable data values."),
      );
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue(
          "shape",
          `${path}.${ownKey}`,
          "SEO fields must be enumerable data properties; accessors are not supported.",
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
  maxItems: number,
  issues: NpSeoContractIssue[],
): readonly unknown[] | null {
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    issues.push(issue("shape", path, "SEO arrays must be inspectable."));
    return null;
  }
  if (!arrayValue) {
    issues.push(issue("shape", path, "SEO collections must be arrays."));
    return null;
  }
  const array = value as unknown[];

  let lengthDescriptor: PropertyDescriptor | undefined;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(array) as object | null;
    lengthDescriptor = Object.getOwnPropertyDescriptor(array, "length");
  } catch {
    issues.push(issue("shape", path, "SEO arrays must be inspectable."));
    return null;
  }
  if (prototype !== Array.prototype) {
    issues.push(issue("shape", path, "SEO collections must be plain arrays."));
    return null;
  }
  const lengthValue: unknown =
    lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
  if (typeof lengthValue !== "number" || !Number.isSafeInteger(lengthValue) || lengthValue < 0) {
    issues.push(issue("shape", path, "SEO arrays must expose a valid data length."));
    return null;
  }
  const length = lengthValue;
  if (length > maxItems) {
    issues.push(
      issue("max-items", path, `SEO collections may contain at most ${maxItems.toString()} items.`),
    );
    return null;
  }

  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(array);
  } catch {
    issues.push(issue("shape", path, "SEO arrays must be inspectable."));
    return null;
  }

  for (const ownKey of ownKeys) {
    if (ownKey === "length") continue;
    const numericIndex = typeof ownKey === "string" ? Number(ownKey) : Number.NaN;
    if (
      typeof ownKey !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(ownKey) ||
      !Number.isSafeInteger(numericIndex) ||
      numericIndex >= length
    ) {
      issues.push(issue("unknown-field", path, "SEO arrays must not contain custom properties."));
      break;
    }
  }

  const result: unknown[] = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array, index.toString());
    } catch {
      issues.push(
        issue(
          "shape",
          `${path}.${index.toString()}`,
          "SEO entries must be inspectable data values.",
        ),
      );
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.push(
        issue(
          "shape",
          `${path}.${index.toString()}`,
          "SEO arrays must be dense and contain only data values.",
        ),
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
  issues: NpSeoContractIssue[],
): void {
  for (const key of inspected.keys) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported SEO field "${key}".`));
    }
  }
}

function parseText(
  value: unknown,
  path: string,
  maxLength: number,
  issues: NpSeoContractIssue[],
  options: { allowEmpty?: boolean; allowLineBreaks?: boolean; trim?: boolean } = {},
): string | null {
  if (typeof value !== "string") {
    issues.push(issue("invalid-field", path, "SEO text fields must be strings."));
    return null;
  }
  const parsed = options.trim ? value.trim() : value;
  if (
    (!options.allowEmpty && parsed.length === 0) ||
    parsed.length > maxLength ||
    !isWellFormedUnicode(parsed) ||
    hasUnsafeTextCodePoint(parsed, options.allowLineBreaks === true)
  ) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `SEO text must contain ${options.allowEmpty ? "0" : "1"}–${maxLength.toString()} safe characters.`,
      ),
    );
    return null;
  }
  return parsed;
}

function parseRootPath(value: unknown, path: string, issues: NpSeoContractIssue[]): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npSeoContractLimits.urlLength ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#") ||
    /\s/u.test(value) ||
    /%(?![0-9A-Fa-f]{2})/u.test(value) ||
    !isWellFormedUnicode(value) ||
    hasUnsafeTextCodePoint(value, false)
  ) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `SEO paths must be safe root-relative URLs of at most ${npSeoContractLimits.urlLength.toString()} characters without fragments.`,
      ),
    );
    return null;
  }

  try {
    const parsed = new URL(value, absoluteBase);
    if (parsed.origin !== absoluteBase || parsed.hash) throw new Error();
    if (hasDotSegment(value.split("?", 1)[0])) throw new Error();
  } catch {
    issues.push(issue("invalid-field", path, "SEO paths must be parseable without dot segments."));
    return null;
  }
  return value;
}

function parseAbsoluteUrl(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npSeoContractLimits.urlLength ||
    value !== value.trim() ||
    value.includes("\\") ||
    /\s/u.test(value) ||
    /%(?![0-9A-Fa-f]{2})/u.test(value) ||
    !isWellFormedUnicode(value) ||
    hasUnsafeTextCodePoint(value, false)
  ) {
    issues.push(issue("invalid-field", path, "SEO URLs must be bounded safe HTTP(S) URLs."));
    return null;
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new Error();
    }
    const schemeEnd = value.indexOf("://") + 3;
    const pathStart = value.indexOf("/", schemeEnd);
    const queryStart = value.indexOf("?", schemeEnd);
    const rawPath =
      pathStart === -1
        ? "/"
        : value.slice(pathStart, queryStart === -1 ? value.length : queryStart);
    if (hasDotSegment(rawPath)) throw new Error();
  } catch {
    issues.push(
      issue("invalid-field", path, "SEO URLs must use HTTP(S), omit credentials and fragments."),
    );
    return null;
  }
  return value;
}

function parseOrigin(value: unknown, path: string, issues: NpSeoContractIssue[]): string | null {
  const url = parseAbsoluteUrl(value, path, issues);
  if (!url) return null;
  const parsed = new URL(url);
  if (url !== parsed.origin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    issues.push(
      issue("invalid-field", path, "SEO origins must be canonical HTTP(S) origins without a path."),
    );
    return null;
  }
  return url;
}

function parseUrlOrPath(value: unknown, path: string, issues: NpSeoContractIssue[]): string | null {
  return typeof value === "string" && value.startsWith("/")
    ? parseRootPath(value, path, issues)
    : parseAbsoluteUrl(value, path, issues);
}

function parseCanonicalIso(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): string | null {
  if (typeof value !== "string" || value.length > 32) {
    issues.push(issue("invalid-field", path, "SEO timestamps must be canonical ISO 8601 strings."));
    return null;
  }
  try {
    const date = new Date(value);
    if (date.toISOString() !== value) throw new Error();
  } catch {
    issues.push(issue("invalid-field", path, "SEO timestamps must be canonical ISO 8601 strings."));
    return null;
  }
  return value;
}

function parseBcp47Locale(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
  allowXDefault = false,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npSeoContractLimits.localeLength
  ) {
    issues.push(issue("invalid-field", path, "SEO locales must be canonical BCP 47 tags."));
    return null;
  }
  if (allowXDefault && value === "x-default") return value;
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    if (!canonical || canonical !== value) throw new Error();
  } catch {
    issues.push(issue("invalid-field", path, "SEO locales must be canonical BCP 47 tags."));
    return null;
  }
  return value;
}

function parseDateObject(value: unknown, path: string, issues: NpSeoContractIssue[]): Date | null {
  try {
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isFinite(milliseconds)) throw new Error();
    return new Date(milliseconds);
  } catch {
    issues.push(issue("invalid-field", path, "metadata dates must be valid Date instances."));
    return null;
  }
}

function parseDateOrIso(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): Date | string | null {
  if (typeof value === "string") return parseCanonicalIso(value, path, issues);
  return parseDateObject(value, path, issues);
}

function parseSitemapAlternate(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): NpSitemapAlternate | null {
  const issueCount = issues.length;
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, sitemapAlternateKeys, path, issues);
  const hreflang = parseBcp47Locale(inspected.fields.hreflang, `${path}.hreflang`, issues, true);
  const href = parseRootPath(inspected.fields.href, `${path}.href`, issues);
  if (issues.length !== issueCount || !hreflang || !href) return null;
  return Object.freeze({ hreflang, href });
}

function parseSitemapAlternates(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): readonly NpSitemapAlternate[] | null {
  const values = inspectArray(value, path, npSeoContractLimits.maxSitemapAlternates, issues);
  if (!values) return null;
  if (values.length === 0) {
    issues.push(issue("invalid-field", path, "empty sitemap alternate arrays must be omitted."));
    return null;
  }
  const alternates: NpSitemapAlternate[] = [];
  const languages = new Map<string, string>();
  for (const [index, entry] of values.entries()) {
    const entryPath = `${path}.${index.toString()}`;
    const alternate = parseSitemapAlternate(entry, entryPath, issues);
    if (!alternate) continue;
    const first = languages.get(alternate.hreflang);
    if (first) {
      issues.push(
        issue(
          "duplicate",
          `${entryPath}.hreflang`,
          `duplicate hreflang "${alternate.hreflang}"; first declared at ${first}.`,
        ),
      );
      continue;
    }
    languages.set(alternate.hreflang, `${entryPath}.hreflang`);
    alternates.push(alternate);
  }
  return Object.freeze(alternates);
}

function parseSitemapEntry(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): NpSitemapEntry | null {
  const issueCount = issues.length;
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, sitemapEntryKeys, path, issues);
  const loc = parseRootPath(inspected.fields.loc, `${path}.loc`, issues);
  const result: NpSitemapEntry = { loc: loc ?? "/" };

  if (Object.hasOwn(inspected.fields, "lastmod")) {
    const lastmod = parseCanonicalIso(inspected.fields.lastmod, `${path}.lastmod`, issues);
    if (lastmod) result.lastmod = lastmod;
  }
  if (Object.hasOwn(inspected.fields, "changefreq")) {
    const value = inspected.fields.changefreq;
    if (typeof value !== "string" || !sitemapChangeFrequencySet.has(value)) {
      issues.push(issue("invalid-field", `${path}.changefreq`, "unsupported sitemap frequency."));
    } else {
      result.changefreq = value as NpSitemapEntry["changefreq"];
    }
  }
  if (Object.hasOwn(inspected.fields, "priority")) {
    const priority = inspected.fields.priority;
    if (
      typeof priority !== "number" ||
      !Number.isFinite(priority) ||
      priority < 0 ||
      priority > 1
    ) {
      issues.push(issue("invalid-field", `${path}.priority`, "sitemap priority must be 0–1."));
    } else {
      result.priority = priority;
    }
  }
  if (Object.hasOwn(inspected.fields, "alternates")) {
    const alternates = parseSitemapAlternates(
      inspected.fields.alternates,
      `${path}.alternates`,
      issues,
    );
    if (alternates) result.alternates = alternates;
  }
  if (issues.length !== issueCount || !loc) return null;
  return Object.freeze(result);
}

function parseSitemapEntries(
  value: unknown,
  path = "sitemapEntries",
): Parsed<readonly NpSitemapEntry[]> {
  const issues: NpSeoContractIssue[] = [];
  const values = inspectArray(value, path, npSeoContractLimits.maxSitemapEntries, issues);
  if (!values) return fail(issues);
  const entries: NpSitemapEntry[] = [];
  const locations = new Map<string, string>();
  for (const [index, value] of values.entries()) {
    const entryPath = `${path}.${index.toString()}`;
    const entry = parseSitemapEntry(value, entryPath, issues);
    if (!entry) continue;
    const first = locations.get(entry.loc);
    if (first) {
      issues.push(
        issue(
          "duplicate",
          `${entryPath}.loc`,
          `duplicate sitemap location; first declared at ${first}.`,
        ),
      );
      continue;
    }
    locations.set(entry.loc, `${entryPath}.loc`);
    entries.push(entry);
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(entries) };
}

function parseSitemapIndexEntry(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): NpSitemapIndexEntry | null {
  const issueCount = issues.length;
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, sitemapIndexEntryKeys, path, issues);
  const loc = parseRootPath(inspected.fields.loc, `${path}.loc`, issues);
  const result: NpSitemapIndexEntry = { loc: loc ?? "/" };
  if (Object.hasOwn(inspected.fields, "lastmod")) {
    const lastmod = parseCanonicalIso(inspected.fields.lastmod, `${path}.lastmod`, issues);
    if (lastmod) result.lastmod = lastmod;
  }
  if (issues.length !== issueCount || !loc) return null;
  return Object.freeze(result);
}

function parseSitemapIndexEntries(value: unknown): Parsed<readonly NpSitemapIndexEntry[]> {
  const path = "sitemapIndexEntries";
  const issues: NpSeoContractIssue[] = [];
  const values = inspectArray(value, path, npSeoContractLimits.maxSitemapEntries, issues);
  if (!values) return fail(issues);
  const entries: NpSitemapIndexEntry[] = [];
  const locations = new Map<string, string>();
  for (const [index, value] of values.entries()) {
    const entryPath = `${path}.${index.toString()}`;
    const entry = parseSitemapIndexEntry(value, entryPath, issues);
    if (!entry) continue;
    const first = locations.get(entry.loc);
    if (first) {
      issues.push(
        issue(
          "duplicate",
          `${entryPath}.loc`,
          `duplicate sitemap location; first declared at ${first}.`,
        ),
      );
      continue;
    }
    locations.set(entry.loc, `${entryPath}.loc`);
    entries.push(entry);
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(entries) };
}

function parseNullableText(
  value: unknown,
  path: string,
  maxLength: number,
  issues: NpSeoContractIssue[],
): string | null | undefined {
  if (value === null) return null;
  return (
    parseText(value, path, maxLength, issues, { allowLineBreaks: true, trim: true }) ?? undefined
  );
}

function parseFeedEntry(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): NpFeedEntry | null {
  const issueCount = issues.length;
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return null;
  pushUnknownFields(inspected, feedEntryKeys, path, issues);
  const id = parseAbsoluteUrl(inspected.fields.id, `${path}.id`, issues);
  const title = parseText(
    inspected.fields.title,
    `${path}.title`,
    npSeoContractLimits.titleLength,
    issues,
    {
      trim: true,
    },
  );
  const summary = parseNullableText(
    inspected.fields.summary,
    `${path}.summary`,
    npSeoContractLimits.summaryLength,
    issues,
  );
  const link = parseAbsoluteUrl(inspected.fields.link, `${path}.link`, issues);
  const author = parseNullableText(
    inspected.fields.author,
    `${path}.author`,
    npSeoContractLimits.authorLength,
    issues,
  );
  const updated = parseCanonicalIso(inspected.fields.updated, `${path}.updated`, issues);
  let published: string | null | undefined;
  if (inspected.fields.published === null) published = null;
  else
    published =
      parseCanonicalIso(inspected.fields.published, `${path}.published`, issues) ?? undefined;

  if (
    issues.length !== issueCount ||
    !id ||
    !title ||
    summary === undefined ||
    !link ||
    author === undefined ||
    !updated ||
    published === undefined
  ) {
    return null;
  }
  return Object.freeze({ id, title, summary, link, author, updated, published });
}

function parseFeedEntries(value: unknown, path = "feedEntries"): Parsed<readonly NpFeedEntry[]> {
  const issues: NpSeoContractIssue[] = [];
  const values = inspectArray(value, path, npSeoContractLimits.maxFeedEntries, issues);
  if (!values) return fail(issues);
  const entries: NpFeedEntry[] = [];
  const ids = new Map<string, string>();
  for (const [index, value] of values.entries()) {
    const entryPath = `${path}.${index.toString()}`;
    const entry = parseFeedEntry(value, entryPath, issues);
    if (!entry) continue;
    const first = ids.get(entry.id);
    if (first) {
      issues.push(
        issue("duplicate", `${entryPath}.id`, `duplicate feed id; first declared at ${first}.`),
      );
      continue;
    }
    ids.set(entry.id, `${entryPath}.id`);
    entries.push(entry);
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(entries) };
}

function parseCollectionSlug(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): string | null {
  if (typeof value !== "string" || value.length > 63 || !collectionSlugPattern.test(value)) {
    issues.push(
      issue("invalid-field", path, "collection names must be lowercase kebab-case slugs."),
    );
    return null;
  }
  return value;
}

function parseCollectionList(
  value: unknown,
  path: string,
  issues: NpSeoContractIssue[],
): readonly string[] | null {
  const values = inspectArray(value, path, npSeoContractLimits.maxCollections, issues);
  if (!values) return null;
  if (values.length === 0) {
    issues.push(issue("invalid-field", path, "empty collection lists must be omitted."));
    return null;
  }
  const result: string[] = [];
  const seen = new Map<string, string>();
  for (const [index, value] of values.entries()) {
    const itemPath = `${path}.${index.toString()}`;
    const slug = parseCollectionSlug(value, itemPath, issues);
    if (!slug) continue;
    const first = seen.get(slug);
    if (first) {
      issues.push(
        issue("duplicate", itemPath, `duplicate collection; first declared at ${first}.`),
      );
      continue;
    }
    seen.set(slug, itemPath);
    result.push(slug);
  }
  return Object.freeze(result);
}

function parsePositiveInteger(
  value: unknown,
  path: string,
  maximum: number,
  issues: NpSeoContractIssue[],
): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    issues.push(
      issue("invalid-field", path, `value must be an integer from 1 to ${maximum.toString()}.`),
    );
    return null;
  }
  return value;
}

function parseSitemapOptions(value: unknown): Parsed<BuildSitemapOptions> {
  const path = "sitemapOptions";
  const issues: NpSeoContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, sitemapOptionsKeys, path, issues);
  const result: BuildSitemapOptions = {};
  if (Object.hasOwn(inspected.fields, "perCollectionLimit")) {
    const limit = parsePositiveInteger(
      inspected.fields.perCollectionLimit,
      `${path}.perCollectionLimit`,
      npSeoContractLimits.maxCollectionLimit,
      issues,
    );
    if (limit) result.perCollectionLimit = limit;
  }
  if (Object.hasOwn(inspected.fields, "collections")) {
    const collections = parseCollectionList(
      inspected.fields.collections,
      `${path}.collections`,
      issues,
    );
    if (collections) result.collections = collections;
  }
  if (Object.hasOwn(inspected.fields, "locale")) {
    const locale = parseBcp47Locale(inspected.fields.locale, `${path}.locale`, issues);
    if (locale) result.locale = locale;
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(result) };
}

function parseAtomOptions(value: unknown): Parsed<BuildAtomFeedOptions> {
  const path = "atomFeedOptions";
  const issues: NpSeoContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, atomOptionsKeys, path, issues);
  const result: BuildAtomFeedOptions = {};
  if (Object.hasOwn(inspected.fields, "collection")) {
    const collection = parseCollectionSlug(
      inspected.fields.collection,
      `${path}.collection`,
      issues,
    );
    if (collection) result.collection = collection;
  }
  if (Object.hasOwn(inspected.fields, "limit")) {
    const limit = parsePositiveInteger(
      inspected.fields.limit,
      `${path}.limit`,
      npSeoContractLimits.maxFeedEntries,
      issues,
    );
    if (limit) result.limit = limit;
  }
  if (Object.hasOwn(inspected.fields, "locale")) {
    const locale = parseBcp47Locale(inspected.fields.locale, `${path}.locale`, issues);
    if (locale) result.locale = locale;
  }
  if (Object.hasOwn(inspected.fields, "extraEntries")) {
    const entries = parseFeedEntries(inspected.fields.extraEntries, `${path}.extraEntries`);
    issues.push(...entries.issues);
    if (entries.value) result.extraEntries = entries.value;
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(result) };
}

function parseOptionalNullableTextField(
  inspected: InspectedRecord,
  key: string,
  path: string,
  maxLength: number,
  issues: NpSeoContractIssue[],
): string | null | undefined {
  if (!Object.hasOwn(inspected.fields, key)) return undefined;
  const value = inspected.fields[key];
  if (value === null) return null;
  return (
    parseText(value, `${path}.${key}`, maxLength, issues, {
      allowEmpty: true,
      allowLineBreaks: key === "description",
      trim: true,
    }) ?? undefined
  );
}

function parseOptionalUrlOrPathField(
  inspected: InspectedRecord,
  key: string,
  path: string,
  issues: NpSeoContractIssue[],
): string | null | undefined {
  if (!Object.hasOwn(inspected.fields, key)) return undefined;
  const value = inspected.fields[key];
  if (value === null) return null;
  return parseUrlOrPath(value, `${path}.${key}`, issues) ?? undefined;
}

function parsePageMetadata(value: unknown): Parsed<NpPageMetadataInput> {
  const path = "pageMetadata";
  const issues: NpSeoContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, pageMetadataKeys, path, issues);
  const result: NpPageMetadataInput = {};
  const title = parseOptionalNullableTextField(
    inspected,
    "title",
    path,
    npSeoContractLimits.titleLength,
    issues,
  );
  if (title !== undefined) result.title = title;
  const description = parseOptionalNullableTextField(
    inspected,
    "description",
    path,
    npSeoContractLimits.descriptionLength,
    issues,
  );
  if (description !== undefined) result.description = description;
  const ogImage = parseOptionalUrlOrPathField(inspected, "ogImage", path, issues);
  if (ogImage !== undefined) result.ogImage = ogImage;
  for (const key of ["path", "canonicalPath"] as const) {
    if (!Object.hasOwn(inspected.fields, key)) continue;
    const parsed = parseRootPath(inspected.fields[key], `${path}.${key}`, issues);
    if (parsed) result[key] = parsed;
  }
  if (Object.hasOwn(inspected.fields, "ogType")) {
    const type = inspected.fields.ogType;
    if (type !== "website" && type !== "article" && type !== "profile") {
      issues.push(issue("invalid-field", `${path}.ogType`, "unsupported Open Graph type."));
    } else result.ogType = type;
  }
  for (const key of ["publishedTime", "modifiedTime"] as const) {
    if (!Object.hasOwn(inspected.fields, key)) continue;
    const value = inspected.fields[key];
    if (value === null) result[key] = null;
    else {
      const date = parseDateObject(value, `${path}.${key}`, issues);
      if (date) result[key] = date;
    }
  }
  if (Object.hasOwn(inspected.fields, "locale")) {
    const locale = parseBcp47Locale(inspected.fields.locale, `${path}.locale`, issues);
    if (locale) result.locale = locale;
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(result) };
}

function parseJsonLdContext(value: unknown): Parsed<BuildJsonLdContext> {
  const path = "jsonLdContext";
  const issues: NpSeoContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, jsonLdContextKeys, path, issues);
  const result: BuildJsonLdContext = {};
  if (Object.hasOwn(inspected.fields, "origin")) {
    const origin = parseOrigin(inspected.fields.origin, `${path}.origin`, issues);
    if (origin) result.origin = origin;
  }
  return issues.length > 0 ? fail(issues) : { issues, value: Object.freeze(result) };
}

function parseArticleInput(value: unknown): Parsed<ArticleJsonLdInput> {
  const path = "articleJsonLd";
  const issues: NpSeoContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, articleKeys, path, issues);
  const url = parseAbsoluteUrl(inspected.fields.url, `${path}.url`, issues);
  const headline = parseText(
    inspected.fields.headline,
    `${path}.headline`,
    npSeoContractLimits.titleLength,
    issues,
    { trim: true },
  );
  const result: ArticleJsonLdInput = { url: url ?? "", headline: headline ?? "" };
  const description = parseOptionalNullableTextField(
    inspected,
    "description",
    path,
    npSeoContractLimits.descriptionLength,
    issues,
  );
  if (description !== undefined) result.description = description;
  const image = parseOptionalUrlOrPathField(inspected, "image", path, issues);
  if (image !== undefined) result.image = image;
  for (const key of ["datePublished", "dateModified"] as const) {
    if (!Object.hasOwn(inspected.fields, key)) continue;
    const raw = inspected.fields[key];
    if (raw === null) result[key] = null;
    else {
      const parsed = parseDateOrIso(raw, `${path}.${key}`, issues);
      if (parsed) result[key] = parsed;
    }
  }
  const authorName = parseOptionalNullableTextField(
    inspected,
    "authorName",
    path,
    npSeoContractLimits.authorLength,
    issues,
  );
  if (authorName !== undefined) result.authorName = authorName;
  if (Object.hasOwn(inspected.fields, "type")) {
    const type = inspected.fields.type;
    if (type !== "BlogPosting" && type !== "Article") {
      issues.push(issue("invalid-field", `${path}.type`, "unsupported article JSON-LD type."));
    } else result.type = type;
  }
  return issues.length > 0 || !url || !headline
    ? fail(issues)
    : { issues, value: Object.freeze(result) };
}

function parsePersonInput(value: unknown): Parsed<PersonJsonLdInput> {
  const path = "personJsonLd";
  const issues: NpSeoContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, personKeys, path, issues);
  const url = parseAbsoluteUrl(inspected.fields.url, `${path}.url`, issues);
  const name = parseText(
    inspected.fields.name,
    `${path}.name`,
    npSeoContractLimits.titleLength,
    issues,
    { trim: true },
  );
  const result: PersonJsonLdInput = { url: url ?? "", name: name ?? "" };
  for (const [key, limit] of [
    ["alternateName", npSeoContractLimits.authorLength],
    ["description", npSeoContractLimits.descriptionLength],
  ] as const) {
    const parsed = parseOptionalNullableTextField(inspected, key, path, limit, issues);
    if (parsed !== undefined) result[key] = parsed;
  }
  const image = parseOptionalUrlOrPathField(inspected, "image", path, issues);
  if (image !== undefined) result.image = image;
  return issues.length > 0 || !url || !name
    ? fail(issues)
    : { issues, value: Object.freeze(result) };
}

function parseSiteSettings(value: unknown): Parsed<NpSiteSeoSettings> {
  const path = "siteSeoSettings";
  const issues: NpSeoContractIssue[] = [];
  const inspected = inspectRecord(value, path, issues);
  if (!inspected) return fail(issues);
  pushUnknownFields(inspected, siteSettingsKeys, path, issues);
  const siteName = parseText(
    inspected.fields.siteName,
    `${path}.siteName`,
    npSeoContractLimits.siteNameLength,
    issues,
  );
  const siteUrl = parseOrigin(inspected.fields.siteUrl, `${path}.siteUrl`, issues);
  const defaultDescription = parseText(
    inspected.fields.defaultDescription,
    `${path}.defaultDescription`,
    npSeoContractLimits.descriptionLength,
    issues,
    { allowEmpty: true, allowLineBreaks: true },
  );
  let defaultOgImage: string | null | undefined;
  if (inspected.fields.defaultOgImage === null) defaultOgImage = null;
  else
    defaultOgImage =
      parseUrlOrPath(inspected.fields.defaultOgImage, `${path}.defaultOgImage`, issues) ??
      undefined;
  let twitterHandle: string | null | undefined;
  if (inspected.fields.twitterHandle === null) twitterHandle = null;
  else if (
    typeof inspected.fields.twitterHandle === "string" &&
    twitterHandlePattern.test(inspected.fields.twitterHandle)
  ) {
    twitterHandle = inspected.fields.twitterHandle;
  } else {
    issues.push(issue("invalid-field", `${path}.twitterHandle`, "invalid Twitter handle."));
  }
  let defaultLocale: string | null = null;
  if (typeof inspected.fields.defaultLocale === "string") {
    const bcp47 = inspected.fields.defaultLocale.replaceAll("_", "-");
    const parsed = parseBcp47Locale(bcp47, `${path}.defaultLocale`, issues);
    if (parsed && parsed.replaceAll("-", "_") === inspected.fields.defaultLocale) {
      defaultLocale = inspected.fields.defaultLocale;
    } else if (parsed) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.defaultLocale`,
          "Open Graph locales must use canonical underscore form.",
        ),
      );
    }
  } else {
    issues.push(issue("invalid-field", `${path}.defaultLocale`, "invalid Open Graph locale."));
  }
  if (
    issues.length > 0 ||
    !siteName ||
    !siteUrl ||
    defaultDescription === null ||
    defaultOgImage === undefined ||
    twitterHandle === undefined ||
    !defaultLocale
  ) {
    return fail(issues);
  }
  return {
    issues,
    value: Object.freeze({
      siteName,
      siteUrl,
      defaultDescription,
      defaultOgImage,
      twitterHandle,
      defaultLocale,
    }),
  };
}

export function npAnalyzeSitemapEntries(value: unknown): NpSeoContractIssue[] {
  return parseSitemapEntries(value).issues;
}

export function npValidateSitemapEntries(value: unknown): NpSeoContractValidationResult {
  const first = npAnalyzeSitemapEntries(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npRequireSitemapEntries(value: unknown): readonly NpSitemapEntry[] {
  const parsed = parseSitemapEntries(value);
  if (!parsed.value) throwContract("Invalid sitemap entries", parsed.issues);
  return parsed.value;
}

export function npDefineSitemapEntries(
  value: readonly NpSitemapEntry[],
): readonly NpSitemapEntry[] {
  return npRequireSitemapEntries(value);
}

export function npAnalyzeSitemapIndexEntries(value: unknown): NpSeoContractIssue[] {
  return parseSitemapIndexEntries(value).issues;
}

export function npRequireSitemapIndexEntries(value: unknown): readonly NpSitemapIndexEntry[] {
  const parsed = parseSitemapIndexEntries(value);
  if (!parsed.value) throwContract("Invalid sitemap index entries", parsed.issues);
  return parsed.value;
}

export function npAnalyzeFeedEntries(value: unknown): NpSeoContractIssue[] {
  return parseFeedEntries(value).issues;
}

export function npValidateFeedEntries(value: unknown): NpSeoContractValidationResult {
  const first = npAnalyzeFeedEntries(value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npRequireFeedEntries(value: unknown): readonly NpFeedEntry[] {
  const parsed = parseFeedEntries(value);
  if (!parsed.value) throwContract("Invalid Atom feed entries", parsed.issues);
  return parsed.value;
}

export function npDefineFeedEntries(value: readonly NpFeedEntry[]): readonly NpFeedEntry[] {
  return npRequireFeedEntries(value);
}

export function npRequireRobotsTxt(value: unknown): string {
  const issues: NpSeoContractIssue[] = [];
  const body = parseText(value, "robotsTxt", npSeoContractLimits.robotsTxtLength, issues, {
    allowEmpty: true,
    allowLineBreaks: true,
  });
  if (body === null) throwContract("Invalid robots.txt body", issues);
  return body;
}

export function npRequireSeoPath(value: unknown): string {
  const issues: NpSeoContractIssue[] = [];
  const path = parseRootPath(value, "seo.path", issues);
  if (!path) throwContract("Invalid SEO path", issues);
  return path;
}

export function npRequireSeoOrigin(value: unknown): string {
  const issues: NpSeoContractIssue[] = [];
  const origin = parseOrigin(value, "seo.origin", issues);
  if (!origin) throwContract("Invalid SEO origin", issues);
  return origin;
}

export function npRequireSitemapOptions(value: unknown): BuildSitemapOptions {
  const parsed = parseSitemapOptions(value);
  if (!parsed.value) throwContract("Invalid sitemap options", parsed.issues);
  return parsed.value;
}

export function npRequireAtomFeedOptions(value: unknown): BuildAtomFeedOptions {
  const parsed = parseAtomOptions(value);
  if (!parsed.value) throwContract("Invalid Atom feed options", parsed.issues);
  return parsed.value;
}

export function npAnalyzePageMetadataInput(value: unknown): NpSeoContractIssue[] {
  return parsePageMetadata(value).issues;
}

export function npRequirePageMetadataInput(value: unknown): NpPageMetadataInput {
  const parsed = parsePageMetadata(value);
  if (!parsed.value) throwContract("Invalid page metadata", parsed.issues);
  return parsed.value;
}

export function npRequireJsonLdContext(value: unknown): BuildJsonLdContext {
  const parsed = parseJsonLdContext(value);
  if (!parsed.value) throwContract("Invalid JSON-LD context", parsed.issues);
  return parsed.value;
}

export function npAnalyzeArticleJsonLdInput(value: unknown): NpSeoContractIssue[] {
  return parseArticleInput(value).issues;
}

export function npRequireArticleJsonLdInput(value: unknown): ArticleJsonLdInput {
  const parsed = parseArticleInput(value);
  if (!parsed.value) throwContract("Invalid article JSON-LD input", parsed.issues);
  return parsed.value;
}

export function npAnalyzePersonJsonLdInput(value: unknown): NpSeoContractIssue[] {
  return parsePersonInput(value).issues;
}

export function npRequirePersonJsonLdInput(value: unknown): PersonJsonLdInput {
  const parsed = parsePersonInput(value);
  if (!parsed.value) throwContract("Invalid person JSON-LD input", parsed.issues);
  return parsed.value;
}

export function npRequireSiteSeoSettings(value: unknown): NpSiteSeoSettings {
  const parsed = parseSiteSettings(value);
  if (!parsed.value) throwContract("Invalid site SEO settings", parsed.issues);
  return parsed.value;
}
