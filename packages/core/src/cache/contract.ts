import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import {
  isNpNavigationLocation,
  npNavigationCollectionSlugPattern,
  npNavigationLimits,
} from "../navigation/contract.js";
import { npPluginIdMaxLength, npPluginIdPattern } from "../settings/contract.js";
import {
  npCacheInvalidationSources,
  type NpCacheInvalidationAdapter,
  type NpCacheInvalidationPath,
  type NpCacheInvalidationPathInput,
  type NpCacheInvalidationRequest,
  type NpCacheInvalidationResult,
  type NpCdnPurgeAdapter,
  type NpNormalizedCacheInvalidationRequest,
} from "./types.js";

export const npCacheContractLimits = {
  adapterKindLength: 64,
  failureMessageLength: 1_024,
  identifierLength: 255,
  keyPartCount: 32,
  keyPartLength: 512,
  pathCount: 128,
  pathLength: 1_024,
  tagCount: 128,
  tagLength: 256,
  ttlSeconds: 31_536_000,
} as const;

export type NpCacheContractIssueCode = "shape" | "unknown-field" | "invalid-field" | "invariant";

export interface NpCacheContractIssue {
  readonly code: NpCacheContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export class NpCacheContractError extends Error {
  readonly issues: NpCacheContractIssue[];

  constructor(message: string, issues: NpCacheContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpCacheContractError";
    this.issues = issues;
  }
}

const adapterKindPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const collectionSlugPattern = new RegExp(npNavigationCollectionSlugPattern, "u");
const pluginIdPattern = new RegExp(npPluginIdPattern, "u");
const themeIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const requestKeys = new Set([
  "source",
  "collection",
  "documentSlug",
  "navigationLocation",
  "pluginId",
  "siteId",
  "themeId",
  "paths",
  "tags",
]);
const pathKeys = new Set(["path", "type"]);
const resultKeys = new Set(["status", "paths", "tags", "cdn"]);
const targetResultKeys = new Set(["requested", "succeeded", "failed"]);
const cdnResultKeys = new Set(["status", "adapterKind"]);
const sourceMetadata = {
  collection: new Set(["collection", "documentSlug"]),
  navigation: new Set(["navigationLocation"]),
  plugin: new Set(["pluginId"]),
  "plugin-config": new Set(["pluginId"]),
  setup: new Set<string>(),
  site: new Set<string>(),
  theme: new Set(["themeId"]),
  "theme-settings": new Set(["themeId"]),
} satisfies Record<(typeof npCacheInvalidationSources)[number], ReadonlySet<string>>;

function issue(
  code: NpCacheContractIssueCode,
  path: string,
  message: string,
): NpCacheContractIssue {
  return { code, path, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key];
      return descriptor?.enumerable === true && "value" in descriptor;
    });
  } catch {
    return false;
  }
}

function pushUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpCacheContractIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported cache field "${key}".`));
    }
  }
}

function readArrayDataElement(
  value: readonly unknown[],
  index: number,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    return descriptor?.enumerable === true && "value" in descriptor
      ? { ok: true, value: descriptor.value }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isBoundedTrimmed(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !hasControl(value)
  );
}

function hasPlaceholder(value: string): boolean {
  return /[{}]/u.test(value);
}

function isCacheTag(value: unknown): value is string {
  return (
    isBoundedTrimmed(value, npCacheContractLimits.tagLength) &&
    !hasPlaceholder(value) &&
    !/\s/u.test(value)
  );
}

function isCachePath(value: unknown): value is string {
  return (
    isBoundedTrimmed(value, npCacheContractLimits.pathLength) &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !/\s/u.test(value) &&
    !hasPlaceholder(value)
  );
}

function analyzePath(value: unknown, path: string): NpCacheContractIssue[] {
  if (typeof value === "string") {
    return isCachePath(value)
      ? []
      : [issue("invalid-field", path, "must be a concrete bounded root-relative path.")];
  }
  if (!isPlainRecord(value))
    return [issue("shape", path, "must be a path string or plain object.")];
  const issues: NpCacheContractIssue[] = [];
  pushUnknownFields(value, pathKeys, path, issues);
  if (!isCachePath(value.path)) {
    issues.push(
      issue("invalid-field", `${path}.path`, "must be a concrete bounded root-relative path."),
    );
  }
  if (value.type !== undefined && value.type !== "layout" && value.type !== "page") {
    issues.push(issue("invalid-field", `${path}.type`, 'must be exactly "layout" or "page".'));
  }
  return issues;
}

function analyzeIdentifier(value: unknown, path: string): NpCacheContractIssue[] {
  return isBoundedTrimmed(value, npCacheContractLimits.identifierLength)
    ? []
    : [issue("invalid-field", path, "must be a bounded concrete trimmed string.")];
}

export function npAnalyzeCacheInvalidationRequest(
  value: unknown,
  path = "cache.invalidation",
): NpCacheContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpCacheContractIssue[] = [];
  pushUnknownFields(value, requestKeys, path, issues);

  if (!npCacheInvalidationSources.includes(value.source as never)) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.source`,
        `must be one of ${npCacheInvalidationSources.join(", ")}.`,
      ),
    );
  }
  if (value.siteId !== null && !npIsCanonicalSiteId(value.siteId)) {
    issues.push(
      issue("invalid-field", `${path}.siteId`, "must be null or a canonical site identifier."),
    );
  }
  for (const field of [
    "collection",
    "documentSlug",
    "navigationLocation",
    "pluginId",
    "themeId",
  ] as const) {
    if (value[field] !== undefined)
      issues.push(...analyzeIdentifier(value[field], `${path}.${field}`));
  }
  if (npCacheInvalidationSources.includes(value.source as never)) {
    const allowed: ReadonlySet<string> =
      sourceMetadata[value.source as keyof typeof sourceMetadata];
    for (const field of [
      "collection",
      "documentSlug",
      "navigationLocation",
      "pluginId",
      "themeId",
    ] as const) {
      if (value[field] !== undefined && !allowed.has(field)) {
        issues.push(
          issue(
            "invariant",
            `${path}.${field}`,
            `is not supported for ${String(value.source)} invalidation.`,
          ),
        );
      }
    }
  }

  const paths = value.paths ?? [];
  if (!Array.isArray(paths)) {
    issues.push(issue("shape", `${path}.paths`, "must be an array when provided."));
  } else if (paths.length > npCacheContractLimits.pathCount) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.paths`,
        `must contain at most ${npCacheContractLimits.pathCount.toString()} entries.`,
      ),
    );
  } else {
    for (let index = 0; index < paths.length; index += 1) {
      const element = readArrayDataElement(paths, index);
      if (!element.ok) {
        issues.push(
          issue(
            "shape",
            `${path}.paths[${index.toString()}]`,
            "must be an enumerable data element.",
          ),
        );
      } else {
        issues.push(...analyzePath(element.value, `${path}.paths[${index.toString()}]`));
      }
    }
  }

  const tags = value.tags ?? [];
  if (!Array.isArray(tags)) {
    issues.push(issue("shape", `${path}.tags`, "must be an array when provided."));
  } else if (tags.length > npCacheContractLimits.tagCount) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.tags`,
        `must contain at most ${npCacheContractLimits.tagCount.toString()} entries.`,
      ),
    );
  } else {
    for (let index = 0; index < tags.length; index += 1) {
      const element = readArrayDataElement(tags, index);
      if (!element.ok || !isCacheTag(element.value)) {
        issues.push(
          issue(
            "invalid-field",
            `${path}.tags[${index.toString()}]`,
            "must be a concrete bounded cache tag without whitespace.",
          ),
        );
      }
    }
  }

  if (Array.isArray(paths) && Array.isArray(tags) && paths.length === 0 && tags.length === 0) {
    issues.push(issue("invariant", path, "must contain at least one path or tag target."));
  }
  if (value.source === "collection" && value.collection === undefined) {
    issues.push(
      issue("invariant", `${path}.collection`, "is required for collection invalidation."),
    );
  }
  if (
    value.source === "collection" &&
    value.collection !== undefined &&
    (typeof value.collection !== "string" ||
      value.collection.length > npNavigationLimits.collectionSlugLength ||
      !collectionSlugPattern.test(value.collection))
  ) {
    issues.push(
      issue("invalid-field", `${path}.collection`, "must be a canonical collection slug."),
    );
  }
  if (value.source === "navigation" && value.navigationLocation === undefined) {
    issues.push(
      issue("invariant", `${path}.navigationLocation`, "is required for navigation invalidation."),
    );
  }
  if (
    value.source === "navigation" &&
    value.navigationLocation !== undefined &&
    !isNpNavigationLocation(value.navigationLocation)
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.navigationLocation`,
        "must be a canonical navigation location.",
      ),
    );
  }
  if (
    (value.source === "plugin" || value.source === "plugin-config") &&
    value.pluginId === undefined
  ) {
    issues.push(issue("invariant", `${path}.pluginId`, "is required for plugin invalidation."));
  }
  if (
    (value.source === "plugin" || value.source === "plugin-config") &&
    value.pluginId !== undefined &&
    (typeof value.pluginId !== "string" ||
      value.pluginId.length > npPluginIdMaxLength ||
      !pluginIdPattern.test(value.pluginId))
  ) {
    issues.push(issue("invalid-field", `${path}.pluginId`, "must be a canonical plugin id."));
  }
  if (
    (value.source === "theme" || value.source === "theme-settings") &&
    value.themeId !== undefined &&
    (typeof value.themeId !== "string" ||
      value.themeId.length > 128 ||
      !themeIdPattern.test(value.themeId))
  ) {
    issues.push(issue("invalid-field", `${path}.themeId`, "must be a canonical theme id."));
  }
  return issues;
}

export function npRequireCacheInvalidationRequest(value: unknown): NpCacheInvalidationRequest {
  const issues = npAnalyzeCacheInvalidationRequest(value);
  if (issues.length > 0) {
    throw new NpCacheContractError("Invalid cache invalidation request", issues);
  }
  return value as NpCacheInvalidationRequest;
}

export function npNormalizeCacheInvalidationRequest(
  value: unknown,
): NpNormalizedCacheInvalidationRequest {
  const request = npRequireCacheInvalidationRequest(value);
  const seenPaths = new Set<string>();
  const paths: NpCacheInvalidationPath[] = [];
  const requestPaths = request.paths ?? [];
  for (let index = 0; index < requestPaths.length; index += 1) {
    const element = readArrayDataElement(requestPaths, index);
    if (!element.ok) {
      throw new NpCacheContractError("Invalid cache invalidation request", [
        issue(
          "shape",
          `cache.invalidation.paths[${index.toString()}]`,
          "must be an enumerable data element.",
        ),
      ]);
    }
    const candidate = element.value as NpCacheInvalidationPathInput;
    const target = typeof candidate === "string" ? { path: candidate } : candidate;
    const key = `${target.path}\0${target.type ?? ""}`;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    paths.push(target.type ? { path: target.path, type: target.type } : { path: target.path });
  }
  return {
    source: request.source,
    siteId: request.siteId,
    ...(request.collection === undefined ? {} : { collection: request.collection }),
    ...(request.documentSlug === undefined ? {} : { documentSlug: request.documentSlug }),
    ...(request.navigationLocation === undefined
      ? {}
      : { navigationLocation: request.navigationLocation }),
    ...(request.pluginId === undefined ? {} : { pluginId: request.pluginId }),
    ...(request.themeId === undefined ? {} : { themeId: request.themeId }),
    paths,
    tags: npRequireCacheTags(request.tags ?? [], "cache.invalidation.tags"),
  };
}

function analyzeTargetResult(
  value: unknown,
  path: string,
  maximum: number,
): NpCacheContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpCacheContractIssue[] = [];
  pushUnknownFields(value, targetResultKeys, path, issues);
  for (const field of ["requested", "succeeded", "failed"] as const) {
    if (
      typeof value[field] !== "number" ||
      !Number.isSafeInteger(value[field]) ||
      value[field] < 0 ||
      value[field] > maximum
    ) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.${field}`,
          `must be an integer from 0 to ${maximum.toString()}.`,
        ),
      );
    }
  }
  if (
    typeof value.requested === "number" &&
    typeof value.succeeded === "number" &&
    typeof value.failed === "number" &&
    value.succeeded + value.failed !== value.requested
  ) {
    issues.push(issue("invariant", path, "succeeded plus failed must equal requested."));
  }
  return issues;
}

function hasValidTargetResultCounts(
  value: unknown,
  maximum: number,
): value is {
  requested: number;
  succeeded: number;
  failed: number;
} {
  if (!isPlainRecord(value)) return false;
  const counts = [value.requested, value.succeeded, value.failed];
  if (
    !counts.every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= maximum,
    )
  ) {
    return false;
  }
  return (value.succeeded as number) + (value.failed as number) === value.requested;
}

export function npAnalyzeCacheInvalidationResult(
  value: unknown,
  path = "cache.invalidation.result",
): NpCacheContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpCacheContractIssue[] = [];
  pushUnknownFields(value, resultKeys, path, issues);
  if (value.status !== "applied" && value.status !== "partial" && value.status !== "unavailable") {
    issues.push(
      issue("invalid-field", `${path}.status`, 'must be "applied", "partial", or "unavailable".'),
    );
  }
  issues.push(
    ...analyzeTargetResult(value.paths, `${path}.paths`, npCacheContractLimits.pathCount),
  );
  issues.push(...analyzeTargetResult(value.tags, `${path}.tags`, npCacheContractLimits.tagCount));
  if (!isPlainRecord(value.cdn)) {
    issues.push(issue("shape", `${path}.cdn`, "must be a plain object."));
  } else {
    pushUnknownFields(value.cdn, cdnResultKeys, `${path}.cdn`, issues);
    if (
      value.cdn.status !== "applied" &&
      value.cdn.status !== "failed" &&
      value.cdn.status !== "not-configured" &&
      value.cdn.status !== "skipped"
    ) {
      issues.push(issue("invalid-field", `${path}.cdn.status`, "has an unsupported status."));
    }
    if (
      value.cdn.adapterKind !== null &&
      (typeof value.cdn.adapterKind !== "string" || !adapterKindPattern.test(value.cdn.adapterKind))
    ) {
      issues.push(
        issue("invalid-field", `${path}.cdn.adapterKind`, "must be null or a canonical kind."),
      );
    }
    if (
      (value.cdn.status === "applied" || value.cdn.status === "failed") &&
      value.cdn.adapterKind === null
    ) {
      issues.push(
        issue("invariant", `${path}.cdn.adapterKind`, "is required for an attempted purge."),
      );
    }
    if (
      (value.cdn.status === "not-configured" || value.cdn.status === "skipped") &&
      value.cdn.adapterKind !== null
    ) {
      issues.push(
        issue("invariant", `${path}.cdn.adapterKind`, "must be null when no purge was attempted."),
      );
    }
  }
  if (
    hasValidTargetResultCounts(value.paths, npCacheContractLimits.pathCount) &&
    hasValidTargetResultCounts(value.tags, npCacheContractLimits.tagCount) &&
    isPlainRecord(value.cdn)
  ) {
    const requested = value.paths.requested + value.tags.requested;
    const succeeded = value.paths.succeeded + value.tags.succeeded;
    const failed = value.paths.failed + value.tags.failed;
    const anySuccess = succeeded > 0 || value.cdn.status === "applied";
    const anyFailure = failed > 0 || value.cdn.status === "failed";
    if (requested === 0) {
      issues.push(issue("invariant", path, "must report at least one requested target."));
    }
    if (value.status === "applied" && (failed > 0 || value.cdn.status === "failed")) {
      issues.push(issue("invariant", `${path}.status`, "applied results cannot contain failures."));
    }
    if (value.status === "unavailable" && anySuccess) {
      issues.push(
        issue("invariant", `${path}.status`, "unavailable results cannot contain successes."),
      );
    }
    if (value.status === "partial" && (!anySuccess || !anyFailure)) {
      issues.push(
        issue("invariant", `${path}.status`, "partial results require both success and failure."),
      );
    }
  }
  return issues;
}

export function npRequireCacheInvalidationResult(value: unknown): NpCacheInvalidationResult {
  const issues = npAnalyzeCacheInvalidationResult(value);
  if (issues.length > 0) {
    throw new NpCacheContractError("Invalid cache invalidation result", issues);
  }
  return value as NpCacheInvalidationResult;
}

export function npRequireCacheInvalidationAdapter(value: unknown): NpCacheInvalidationAdapter {
  const issues: NpCacheContractIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(issue("shape", "cache.adapter", "must be an object."));
  } else {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.kind !== "string" || !adapterKindPattern.test(candidate.kind)) {
      issues.push(
        issue("invalid-field", "cache.adapter.kind", "must be a canonical lowercase kind."),
      );
    }
    if (typeof candidate.invalidate !== "function") {
      issues.push(issue("invalid-field", "cache.adapter.invalidate", "must be a function."));
    }
    if (candidate.shutdown !== undefined && typeof candidate.shutdown !== "function") {
      issues.push(
        issue("invalid-field", "cache.adapter.shutdown", "must be a function when provided."),
      );
    }
  }
  if (issues.length > 0) throw new NpCacheContractError("Invalid cache adapter", issues);
  return value as NpCacheInvalidationAdapter;
}

export function npRequireCdnPurgeAdapter(value: unknown): NpCdnPurgeAdapter {
  const issues: NpCacheContractIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(issue("shape", "cache.cdnAdapter", "must be an object."));
  } else {
    const candidate = value as Record<string, unknown>;
    if (
      candidate.kind !== undefined &&
      (typeof candidate.kind !== "string" || !adapterKindPattern.test(candidate.kind))
    ) {
      issues.push(
        issue("invalid-field", "cache.cdnAdapter.kind", "must be a canonical lowercase kind."),
      );
    }
    if (typeof candidate.purge !== "function") {
      issues.push(issue("invalid-field", "cache.cdnAdapter.purge", "must be a function."));
    }
    if (candidate.shutdown !== undefined && typeof candidate.shutdown !== "function") {
      issues.push(
        issue("invalid-field", "cache.cdnAdapter.shutdown", "must be a function when provided."),
      );
    }
  }
  if (issues.length > 0) throw new NpCacheContractError("Invalid CDN purge adapter", issues);
  return value as NpCdnPurgeAdapter;
}

export function npCdnPurgeAdapterKind(adapter: NpCdnPurgeAdapter): string {
  return adapter.kind ?? "custom";
}

export function npRequireCacheTags(value: unknown, path = "cache.tags"): string[] {
  if (!Array.isArray(value)) {
    throw new NpCacheContractError("Invalid cache tags", [
      issue("shape", path, "must be an array."),
    ]);
  }
  const issues: NpCacheContractIssue[] = [];
  const tags: string[] = [];
  if (value.length > npCacheContractLimits.tagCount) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must contain at most ${npCacheContractLimits.tagCount.toString()} entries.`,
      ),
    );
  }
  const inspectedTagCount = Math.min(value.length, npCacheContractLimits.tagCount);
  for (let index = 0; index < inspectedTagCount; index += 1) {
    const element = readArrayDataElement(value, index);
    if (!element.ok || !isCacheTag(element.value)) {
      issues.push(
        issue("invalid-field", `${path}[${index.toString()}]`, "must be a concrete cache tag."),
      );
    } else {
      tags.push(element.value);
    }
  }
  if (issues.length > 0) throw new NpCacheContractError("Invalid cache tags", issues);
  return [...new Set(tags)];
}

export function npRequireCacheKeyParts(value: unknown, path = "cache.keyParts"): string[] {
  if (!Array.isArray(value)) {
    throw new NpCacheContractError("Invalid cache key parts", [
      issue("shape", path, "must be an array."),
    ]);
  }
  const issues: NpCacheContractIssue[] = [];
  const keyParts: string[] = [];
  if (value.length === 0 || value.length > npCacheContractLimits.keyPartCount) {
    issues.push(
      issue(
        "invalid-field",
        path,
        `must contain 1-${npCacheContractLimits.keyPartCount.toString()} entries.`,
      ),
    );
  }
  const inspectedKeyPartCount = Math.min(value.length, npCacheContractLimits.keyPartCount);
  for (let index = 0; index < inspectedKeyPartCount; index += 1) {
    const element = readArrayDataElement(value, index);
    if (!element.ok || !isBoundedTrimmed(element.value, npCacheContractLimits.keyPartLength)) {
      issues.push(
        issue(
          "invalid-field",
          `${path}[${index.toString()}]`,
          "must be a bounded non-empty trimmed string.",
        ),
      );
    } else {
      keyParts.push(element.value);
    }
  }
  if (issues.length > 0) throw new NpCacheContractError("Invalid cache key parts", issues);
  return keyParts;
}

export function npRequireCacheTtl(value: unknown, path = "cache.revalidate"): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > npCacheContractLimits.ttlSeconds
  ) {
    throw new NpCacheContractError("Invalid cache TTL", [
      issue(
        "invalid-field",
        path,
        `must be an integer from 1 to ${npCacheContractLimits.ttlSeconds.toString()} seconds.`,
      ),
    ]);
  }
  return value;
}
