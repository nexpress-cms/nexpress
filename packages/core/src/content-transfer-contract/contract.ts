import { z } from "zod";

import { npAnalyzeNavigationItems, npAnalyzeNavigationLocation } from "../navigation/contract.js";
import { npMediaContractLimits } from "../media-contract/contract.js";
import {
  npAnalyzeSettingValue,
  npAnalyzeSiteGeneralSettings,
  npPluginIdMaxLength,
  npPluginIdPattern,
} from "../settings/contract.js";
import { npAnalyzeThemeTokensOverlay } from "../theme/contract.js";
import {
  NP_CONTENT_TRANSFER_VERSION,
  type NpContentTransferContractIssue,
  type NpContentTransferContractResult,
  type NpContentTransferEnvelope,
  type NpContentTransferFullEnvelope,
  type NpContentTransferImportReport,
  type NpContentTransferJsonValue,
} from "./types.js";

export const npContentTransferContractLimits = {
  bodyBytes: 32 * 1024 * 1024,
  collections: 128,
  collectionSlugLength: 96,
  documentsPerCollection: 10_000,
  documentsTotal: 25_000,
  mediaItems: 25_000,
  plugins: 1_000,
  settings: 1_000,
  navigationLocations: 256,
  warnings: 2_000,
  contractIssues: 2_000,
  textLength: 2_000,
  warningLength: 4_000,
  jsonStringLength: 2_000_000,
  jsonDepth: 96,
  jsonNodes: 1_000_000,
  jsonArrayItems: 100_000,
  jsonObjectKeys: 20_000,
  jsonKeyLength: 256,
} as const;

export const npContentTransferCollectionSlugPattern = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
export const npContentTransferPluginIdPattern = npPluginIdPattern;
export const npContentTransferPluginVersionPattern =
  "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-.]+)?(?:\\+[0-9A-Za-z-.]+)?$";
export const npContentTransferUuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
export const npContentTransferCanonicalDatePattern =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
export const npContentTransferSha256Pattern = "^[0-9a-f]{64}$";
export const npContentTransferMimeTypePattern =
  "^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$";

const INVALID = Symbol("invalid-content-transfer-value");
const COLLECTION_SLUG = new RegExp(npContentTransferCollectionSlugPattern, "u");
const PLUGIN_ID = new RegExp(npContentTransferPluginIdPattern, "u");
const PLUGIN_VERSION = new RegExp(npContentTransferPluginVersionPattern, "u");
const UUID = new RegExp(npContentTransferUuidPattern, "u");
const CANONICAL_DATE = new RegExp(npContentTransferCanonicalDatePattern, "u");
const SHA256 = new RegExp(npContentTransferSha256Pattern, "u");
const MIME_TYPE = new RegExp(npContentTransferMimeTypePattern, "u");
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const PORTABLE_SETTING_EXCLUSIONS = ["theme", "jobs.paused"];
const PORTABLE_SETTING_PREFIX_EXCLUSIONS = ["plugin.config:"];

interface JsonState {
  nodes: number;
  readonly ancestors: Set<object>;
}

export class NpContentTransferContractError extends TypeError {
  readonly issues: readonly NpContentTransferContractIssue[];
  readonly contractIssues: readonly NpContentTransferContractIssue[];

  constructor(message: string, issues: readonly NpContentTransferContractIssue[]) {
    const first = issues[0];
    super(first ? `${message}: ${first.path}: ${first.message}` : message);
    this.name = "NpContentTransferContractError";
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
    this.contractIssues = this.issues;
  }
}

/** Locale-independent UTF-16 ordering used by every canonical transfer inventory. */
export function npCompareContentTransferText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(
  issues: NpContentTransferContractIssue[],
  code: NpContentTransferContractIssue["code"],
  path: string,
  message: string,
): void {
  if (issues.length < npContentTransferContractLimits.contractIssues) {
    issues.push({ code, path, message });
  }
}

function hasUnsafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasControlText(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function setDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function cloneJson(
  value: unknown,
  path: string,
  depth: number,
  state: JsonState,
  issues: NpContentTransferContractIssue[],
): NpContentTransferJsonValue | typeof INVALID {
  state.nodes += 1;
  if (state.nodes > npContentTransferContractLimits.jsonNodes) {
    issue(issues, "limit", path, "exceeds the content-transfer JSON node limit.");
    return INVALID;
  }
  if (depth > npContentTransferContractLimits.jsonDepth) {
    issue(issues, "limit", path, "exceeds the content-transfer JSON depth limit.");
    return INVALID;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issue(issues, "invalid-field", path, "must be a finite JSON number.");
      return INVALID;
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (value.length > npContentTransferContractLimits.jsonStringLength || hasUnsafeText(value)) {
      issue(issues, "invalid-field", path, "must be bounded well-formed text.");
      return INVALID;
    }
    return value;
  }
  if (typeof value !== "object" || value === null) {
    issue(issues, "invalid-field", path, "must contain only JSON values.");
    return INVALID;
  }
  if (state.ancestors.has(value)) {
    issue(issues, "invariant", path, "must not contain circular values.");
    return INVALID;
  }
  state.ancestors.add(value);

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    state.ancestors.delete(value);
    issue(issues, "shape", path, "must be inspectable JSON data.");
    return INVALID;
  }

  if (isArray) {
    let prototype: object | null;
    let keys: readonly PropertyKey[];
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      prototype = Object.getPrototypeOf(value) as object | null;
      keys = Reflect.ownKeys(value);
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    } catch {
      state.ancestors.delete(value);
      issue(issues, "shape", path, "must be an inspectable plain array.");
      return INVALID;
    }
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
    if (
      prototype !== Array.prototype ||
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > npContentTransferContractLimits.jsonArrayItems
    ) {
      state.ancestors.delete(value);
      issue(
        issues,
        prototype === Array.prototype && typeof length === "number" ? "limit" : "shape",
        path,
        "must be a bounded plain array.",
      );
      return INVALID;
    }
    const allowed = new Set(Array.from({ length }, (_, index) => index.toString()));
    if (keys.some((key) => key !== "length" && (typeof key !== "string" || !allowed.has(key)))) {
      state.ancestors.delete(value);
      issue(issues, "unknown-field", path, "must not contain custom array properties.");
      return INVALID;
    }
    const output: NpContentTransferJsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
      } catch {
        issue(issues, "shape", `${path}[${index.toString()}]`, "must be inspectable.");
        continue;
      }
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        issue(issues, "shape", `${path}[${index.toString()}]`, "must be a plain data element.");
        continue;
      }
      const entry = cloneJson(
        descriptor.value,
        `${path}[${index.toString()}]`,
        depth + 1,
        state,
        issues,
      );
      if (entry !== INVALID) output.push(entry);
    }
    state.ancestors.delete(value);
    return output;
  }

  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    keys = Reflect.ownKeys(value);
  } catch {
    state.ancestors.delete(value);
    issue(issues, "shape", path, "must be an inspectable plain object.");
    return INVALID;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    state.ancestors.delete(value);
    issue(issues, "shape", path, "must be a plain object.");
    return INVALID;
  }
  if (keys.length > npContentTransferContractLimits.jsonObjectKeys) {
    state.ancestors.delete(value);
    issue(issues, "limit", path, "contains too many object fields.");
    return INVALID;
  }
  const output: Record<string, NpContentTransferJsonValue> = {};
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > npContentTransferContractLimits.jsonKeyLength ||
      hasUnsafeText(key) ||
      DANGEROUS_KEYS.has(key)
    ) {
      issue(issues, "unknown-field", path, "contains an invalid object key.");
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      issue(issues, "shape", `${path}.${key}`, "must be inspectable.");
      continue;
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      issue(issues, "shape", `${path}.${key}`, "must be a plain data property.");
      continue;
    }
    const entry = cloneJson(descriptor.value, `${path}.${key}`, depth + 1, state, issues);
    if (entry !== INVALID) setDataProperty(output, key, entry);
  }
  state.ancestors.delete(value);
  return output;
}

const boundedText = (maximum: number = npContentTransferContractLimits.textLength) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !hasUnsafeText(value), "must be well-formed text");
const collectionSlug = z
  .string()
  .max(npContentTransferContractLimits.collectionSlugLength)
  .regex(COLLECTION_SLUG);
const pluginId = z.string().max(npPluginIdMaxLength).regex(PLUGIN_ID);
const uuid = z.string().regex(UUID);
const jsonValue = z.custom<NpContentTransferJsonValue>();
const jsonObject = z.record(z.string(), jsonValue);
const canonicalDate = z
  .string()
  .regex(CANONICAL_DATE)
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
  }, "must be a canonical UTC ISO timestamp");
const siteUrl = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "/" || url.pathname === "") &&
      url.origin === value
    );
  }, "must be a canonical HTTP(S) origin");

function relativeZodPath(path: string, prefix: string): Array<string | number> {
  if (path === prefix) return [];
  if (!path.startsWith(`${prefix}.`)) return [];
  return path
    .slice(prefix.length + 1)
    .split(".")
    .map((part) => (/^(?:0|[1-9][0-9]*)$/u.test(part) ? Number(part) : part));
}

const siteSchema = z.custom<NpContentTransferFullEnvelope["site"]>().superRefine((value, ctx) => {
  for (const entry of npAnalyzeSiteGeneralSettings(value)) {
    ctx.addIssue({
      code: "custom",
      message: entry.message,
      path: relativeZodPath(entry.path, "settings.site"),
    });
  }
});

const themeSchema = z
  .custom<NonNullable<NpContentTransferFullEnvelope["theme"]>>()
  .superRefine((value, ctx) => {
    for (const entry of npAnalyzeThemeTokensOverlay(value)) {
      ctx.addIssue({
        code: "custom",
        message: entry.message,
        path: relativeZodPath(entry.path, "theme"),
      });
    }
  });

const settingsSchema = z
  .record(z.string().min(1).max(npContentTransferContractLimits.jsonKeyLength), jsonValue)
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > npContentTransferContractLimits.settings) {
      ctx.addIssue({ code: "custom", message: "[limit] contains too many settings" });
    }
    for (const [key, settingValue] of Object.entries(value)) {
      if (
        PORTABLE_SETTING_EXCLUSIONS.includes(key) ||
        PORTABLE_SETTING_PREFIX_EXCLUSIONS.some((prefix) => key.startsWith(prefix))
      ) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "belongs in a dedicated top-level transfer section",
        });
        continue;
      }
      for (const entry of npAnalyzeSettingValue(key, settingValue)) {
        ctx.addIssue({
          code: "custom",
          path: [key, ...relativeZodPath(entry.path, `settings.${key}`)],
          message: entry.message,
        });
      }
    }
  });

const navigationSchema = z
  .record(z.string(), z.custom<NpContentTransferFullEnvelope["navigation"][string]>())
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > npContentTransferContractLimits.navigationLocations) {
      ctx.addIssue({ code: "custom", message: "[limit] contains too many navigation locations" });
    }
    for (const [location, items] of Object.entries(value)) {
      for (const entry of npAnalyzeNavigationLocation(location)) {
        ctx.addIssue({ code: "custom", path: [location], message: entry.message });
      }
      for (const entry of npAnalyzeNavigationItems(items)) {
        ctx.addIssue({
          code: "custom",
          path: [location, ...relativeZodPath(entry.path, "navigation.items")],
          message: entry.message,
        });
      }
    }
  });

const documentSchema = z.record(z.string(), jsonValue);
const collectionsSchema = z
  .record(
    collectionSlug,
    z.array(documentSchema).max(npContentTransferContractLimits.documentsPerCollection),
  )
  .superRefine((value, ctx) => {
    const entries = Object.entries(value);
    if (entries.length > npContentTransferContractLimits.collections) {
      ctx.addIssue({ code: "custom", message: "[limit] contains too many collections" });
    }
    const total = entries.reduce((count, [, documents]) => count + documents.length, 0);
    if (total > npContentTransferContractLimits.documentsTotal) {
      ctx.addIssue({ code: "custom", message: "[limit] contains too many documents" });
    }
  });

const mediaItemSchema = z
  .object({
    id: uuid,
    filename: boundedText(npMediaContractLimits.filenameLength).refine(
      (value) => value === value.trim() && !hasControlText(value),
      "must be canonical media filename text",
    ),
    hash: z.string().regex(SHA256),
    mimeType: z.string().max(npMediaContractLimits.mimeTypeLength).regex(MIME_TYPE),
  })
  .strict();

const pluginSchema = z
  .object({
    id: pluginId,
    enabled: z.boolean(),
    config: jsonObject,
    manifestVersion: boundedText(128).regex(PLUGIN_VERSION).nullable(),
  })
  .strict();

function addOrderedUniqueIssues(
  values: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: `[duplicate] repeats "${value}"`,
      });
    }
    seen.add(value);
  }
  const sorted = [...values].sort(npCompareContentTransferText);
  if (sorted.some((value, index) => value !== values[index])) {
    ctx.addIssue({ code: "custom", path, message: "[invariant] must be sorted" });
  }
}

const baseShape = {
  version: z.literal(NP_CONTENT_TRANSFER_VERSION),
  exportedAt: canonicalDate,
  siteUrl: siteUrl.nullable(),
  collectionsExported: z.array(collectionSlug).max(npContentTransferContractLimits.collections),
  collections: collectionsSchema,
  media: z.array(mediaItemSchema).max(npContentTransferContractLimits.mediaItems),
};

const partialEnvelopeSchema = z
  .object({ ...baseShape, partial: z.literal(true) })
  .strict()
  .superRefine(analyzeEnvelopeInvariants);
const fullEnvelopeSchema = z
  .object({
    ...baseShape,
    partial: z.literal(false),
    site: siteSchema,
    theme: themeSchema.nullable(),
    settings: settingsSchema,
    navigation: navigationSchema,
    plugins: z.array(pluginSchema).max(npContentTransferContractLimits.plugins),
  })
  .strict()
  .superRefine(analyzeEnvelopeInvariants);

function analyzeEnvelopeInvariants(
  value: z.infer<typeof partialEnvelopeSchema> | z.infer<typeof fullEnvelopeSchema>,
  ctx: z.RefinementCtx,
): void {
  addOrderedUniqueIssues(value.collectionsExported, ["collectionsExported"], ctx);
  const collectionKeys = Object.keys(value.collections).sort(npCompareContentTransferText);
  if (
    collectionKeys.length !== value.collectionsExported.length ||
    collectionKeys.some((slug, index) => slug !== value.collectionsExported[index])
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["collectionsExported"],
      message: "[invariant] must exactly match the sorted collection payload keys",
    });
  }
  addOrderedUniqueIssues(
    value.media.map((entry) => entry.id),
    ["media"],
    ctx,
  );
  for (const [collection, documents] of Object.entries(value.collections)) {
    const ids: string[] = [];
    for (const [index, document] of documents.entries()) {
      if (typeof document.id !== "string" || !UUID.test(document.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["collections", collection, index, "id"],
          message: "must be a canonical UUID",
        });
      } else {
        ids.push(document.id);
      }
    }
    addOrderedUniqueIssues(ids, ["collections", collection], ctx);
  }
  if (!value.partial) {
    addOrderedUniqueIssues(
      value.plugins.map((entry) => entry.id),
      ["plugins"],
      ctx,
    );
    const hasInspectableSite =
      typeof value.site === "object" && value.site !== null && !Array.isArray(value.site);
    if (hasInspectableSite && value.siteUrl !== value.site.url) {
      ctx.addIssue({
        code: "custom",
        path: ["siteUrl"],
        message: "[invariant] must equal site.url for a full transfer",
      });
    }
  }
}

const countsSchema = z
  .object({
    site: z.number().int().min(0).max(1),
    theme: z.number().int().min(0).max(1),
    settings: z.number().int().nonnegative().max(npContentTransferContractLimits.settings),
    navigation: z
      .number()
      .int()
      .nonnegative()
      .max(npContentTransferContractLimits.navigationLocations),
    documentsCreated: z
      .number()
      .int()
      .nonnegative()
      .max(npContentTransferContractLimits.documentsTotal),
    documentsUpdated: z
      .number()
      .int()
      .nonnegative()
      .max(npContentTransferContractLimits.documentsTotal),
    mediaMatched: z.number().int().nonnegative().max(npContentTransferContractLimits.mediaItems),
    pluginsUpdated: z.number().int().nonnegative().max(npContentTransferContractLimits.plugins),
  })
  .strict();
const reportSchema = z
  .object({
    imported: countsSchema,
    warnings: z
      .array(
        z
          .string()
          .max(npContentTransferContractLimits.warningLength)
          .refine((value) => !hasUnsafeText(value)),
      )
      .max(npContentTransferContractLimits.warnings),
    dryRun: z.boolean(),
    partial: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.imported.documentsCreated + value.imported.documentsUpdated >
      npContentTransferContractLimits.documentsTotal
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["imported"],
        message: "[limit] document counts exceed the transfer document limit",
      });
    }
    const fullSectionCounts = [
      value.imported.site,
      value.imported.theme,
      value.imported.settings,
      value.imported.navigation,
      value.imported.pluginsUpdated,
    ];
    if (value.partial && fullSectionCounts.some((count) => count !== 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["imported"],
        message: "[invariant] partial reports cannot include full-site mutations",
      });
    }
    if (!value.partial && (value.imported.site !== 1 || value.imported.theme !== 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["imported"],
        message: "[invariant] full reports must apply the site and theme sections",
      });
    }
  });

function pathFromZod(path: PropertyKey[]): string {
  let output = "transfer";
  for (const part of path) {
    output += typeof part === "number" ? `[${part.toString()}]` : `.${String(part)}`;
  }
  return output;
}

function zodIssueCode(entry: z.core.$ZodIssue): NpContentTransferContractIssue["code"] {
  if (entry.code === "unrecognized_keys") return "unknown-field";
  if (entry.code === "too_big") return "limit";
  if (entry.message.startsWith("[limit]")) return "limit";
  if (entry.message.startsWith("[duplicate]")) return "duplicate";
  if (entry.message.startsWith("[invariant]")) return "invariant";
  return entry.code === "invalid_type" ? "shape" : "invalid-field";
}

function issuesFromZod(error: z.ZodError): NpContentTransferContractIssue[] {
  return error.issues.slice(0, npContentTransferContractLimits.contractIssues).map((entry) => ({
    code: zodIssueCode(entry),
    path: pathFromZod(entry.path),
    message: entry.message.replace(/^\[(?:duplicate|invariant|limit)\]\s*/u, ""),
  }));
}

function success<T>(value: T): NpContentTransferContractResult<T> {
  return { ok: true, value, issues: [] };
}

function failure<T>(issues: NpContentTransferContractIssue[]): NpContentTransferContractResult<T> {
  return { ok: false, value: null, issues: Object.freeze(issues) };
}

function canonicalJson(
  value: unknown,
):
  | { ok: true; value: NpContentTransferJsonValue }
  | { ok: false; issues: NpContentTransferContractIssue[] } {
  const issues: NpContentTransferContractIssue[] = [];
  const cloned = cloneJson(value, "transfer", 0, { nodes: 0, ancestors: new Set() }, issues);
  return cloned === INVALID || issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: cloned };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function npAnalyzeContentTransferEnvelope(
  value: unknown,
): NpContentTransferContractResult<NpContentTransferEnvelope> {
  const canonical = canonicalJson(value);
  if (!canonical.ok) return failure(canonical.issues);
  const partialDiscriminant =
    typeof canonical.value === "object" &&
    canonical.value !== null &&
    !Array.isArray(canonical.value)
      ? canonical.value.partial
      : undefined;
  const parsed =
    partialDiscriminant === true
      ? partialEnvelopeSchema.safeParse(canonical.value)
      : partialDiscriminant === false
        ? fullEnvelopeSchema.safeParse(canonical.value)
        : z.object({ partial: z.boolean() }).passthrough().safeParse(canonical.value);
  if (!parsed.success) return failure(issuesFromZod(parsed.error));
  if (partialDiscriminant !== true && partialDiscriminant !== false) {
    return failure([
      {
        code: "invalid-field",
        path: "transfer.partial",
        message: "must be exactly true or false",
      },
    ]);
  }
  const bytes = byteLength(parsed.data);
  if (bytes > npContentTransferContractLimits.bodyBytes) {
    return failure([
      {
        code: "limit",
        path: "transfer",
        message: `serialized transfer exceeds ${npContentTransferContractLimits.bodyBytes.toString()} bytes; export fewer collections`,
      },
    ]);
  }
  return success(parsed.data as NpContentTransferEnvelope);
}

export function npRequireContentTransferEnvelope(value: unknown): NpContentTransferEnvelope {
  const result = npAnalyzeContentTransferEnvelope(value);
  if (result.ok) return result.value;
  throw new NpContentTransferContractError("Invalid content transfer", result.issues);
}

export function npAnalyzeContentTransferImportReport(
  value: unknown,
): NpContentTransferContractResult<NpContentTransferImportReport> {
  const canonical = canonicalJson(value);
  if (!canonical.ok) return failure(canonical.issues);
  const parsed = reportSchema.safeParse(canonical.value);
  return parsed.success ? success(parsed.data) : failure(issuesFromZod(parsed.error));
}

export function npRequireContentTransferImportReport(
  value: unknown,
): NpContentTransferImportReport {
  const result = npAnalyzeContentTransferImportReport(value);
  if (result.ok) return result.value;
  throw new NpContentTransferContractError("Invalid content-transfer import report", result.issues);
}

export function npRequireContentTransferCollectionFilter(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || hasUnsafeText(value)) {
    throw new NpContentTransferContractError("Invalid collection filter", [
      { code: "invalid-field", path: "collections", message: "must be canonical CSV text" },
    ]);
  }
  const entries = value.split(",");
  const issues: NpContentTransferContractIssue[] = [];
  if (entries.length > npContentTransferContractLimits.collections) {
    issue(issues, "limit", "collections", "contains too many collection slugs");
  }
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (
      entry.length > npContentTransferContractLimits.collectionSlugLength ||
      !COLLECTION_SLUG.test(entry)
    ) {
      issue(
        issues,
        "invalid-field",
        `collections[${index.toString()}]`,
        "must be a lowercase collection slug without padding",
      );
    }
    if (seen.has(entry)) {
      issue(issues, "duplicate", `collections[${index.toString()}]`, `repeats "${entry}"`);
    }
    seen.add(entry);
  }
  if (issues.length > 0)
    throw new NpContentTransferContractError("Invalid collection filter", issues);
  return entries;
}

export function npRequireContentTransferDryRun(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new NpContentTransferContractError("Invalid dry-run flag", [
    { code: "invalid-field", path: "dryRun", message: 'must be exactly "true" or "false"' },
  ]);
}
