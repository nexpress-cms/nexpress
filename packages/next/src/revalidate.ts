import { getCurrentSiteId } from "@nexpress/core/sites";
import { npCacheContractLimits, type NpCacheInvalidationResult } from "@nexpress/core/cache";
import { npNavigationCollectionSlugPattern, npNavigationLimits } from "@nexpress/core/navigation";
import { invalidateCacheTargets } from "./cdn-purge.js";

export interface CollectionRevalidationRule {
  /** Concrete paths or templates containing only `{slug}` and `{siteId}`. */
  paths: readonly string[];
  /** Concrete tags or templates containing only `{slug}` and `{siteId}`. */
  tags?: readonly string[];
}

export type RevalidationMap = Record<string, CollectionRevalidationRule>;

interface SubstituteContext {
  documentSlug: string | undefined;
  siteId: string | null;
}

interface RevalidationTargets {
  paths: string[];
  tags: string[];
}

const collectionSlugPattern = new RegExp(npNavigationCollectionSlugPattern, "u");
const allowedPlaceholders = new Set(["slug", "siteId"]);

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
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

export function collectionCacheTag(slug: string): string {
  if (
    typeof slug !== "string" ||
    slug.length > npNavigationLimits.collectionSlugLength ||
    !collectionSlugPattern.test(slug)
  ) {
    throw new TypeError("Collection cache tag requires a canonical collection slug.");
  }
  return `nx:collection:${slug}`;
}

function assertTemplate(value: unknown, kind: "path" | "tag"): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length >
      (kind === "path" ? npCacheContractLimits.pathLength : npCacheContractLimits.tagLength) ||
    value !== value.trim() ||
    hasControl(value) ||
    (kind === "tag" && /\s/u.test(value))
  ) {
    throw new TypeError(`Cache revalidation ${kind} templates must be non-empty trimmed strings.`);
  }
  if (
    kind === "path" &&
    (!value.startsWith("/") ||
      value.startsWith("//") ||
      value.includes("\\") ||
      value.includes("?") ||
      value.includes("#") ||
      /\s/u.test(value))
  ) {
    throw new TypeError("Cache revalidation path templates must be root-relative.");
  }
  const placeholders = [...value.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]);
  if (/[{}]/u.test(value.replace(/\{[^{}]+\}/gu, ""))) {
    throw new TypeError(`Cache revalidation ${kind} template has malformed placeholders.`);
  }
  for (const placeholder of placeholders) {
    if (!placeholder || !allowedPlaceholders.has(placeholder)) {
      throw new TypeError(`Unsupported cache revalidation placeholder "${placeholder ?? ""}".`);
    }
  }
}

export function npRequireRevalidationMap(value: unknown): RevalidationMap {
  if (!isPlainDataRecord(value)) {
    throw new TypeError("Cache revalidation rules must be a plain object.");
  }
  const validated: RevalidationMap = {};
  for (const [collection, rawRule] of Object.entries(value)) {
    collectionCacheTag(collection);
    if (!isPlainDataRecord(rawRule)) {
      throw new TypeError(`Cache revalidation rule for "${collection}" must be a plain object.`);
    }
    const rule = rawRule;
    for (const key of Object.keys(rule)) {
      if (key !== "paths" && key !== "tags") {
        throw new TypeError(`Unsupported cache revalidation field "${collection}.${key}".`);
      }
    }
    if (!Array.isArray(rule.paths)) {
      throw new TypeError(`Cache revalidation paths for "${collection}" must be an array.`);
    }
    if (rule.tags !== undefined && !Array.isArray(rule.tags)) {
      throw new TypeError(`Cache revalidation tags for "${collection}" must be an array.`);
    }
    if (rule.paths.length > npCacheContractLimits.pathCount) {
      throw new TypeError(`Cache revalidation paths for "${collection}" exceed the target limit.`);
    }
    if (Array.isArray(rule.tags) && rule.tags.length + 1 > npCacheContractLimits.tagCount) {
      throw new TypeError(`Cache revalidation tags for "${collection}" exceed the target limit.`);
    }
    const paths: string[] = [];
    for (let index = 0; index < rule.paths.length; index += 1) {
      const element = readArrayDataElement(rule.paths, index);
      if (!element.ok) {
        throw new TypeError(
          `Cache revalidation path ${collection}.${index.toString()} must be an enumerable data element.`,
        );
      }
      assertTemplate(element.value, "path");
      paths.push(element.value);
    }
    const tags = (rule.tags as unknown[] | undefined) ?? [];
    const validatedTags: string[] = [];
    for (let index = 0; index < tags.length; index += 1) {
      const element = readArrayDataElement(tags, index);
      if (!element.ok) {
        throw new TypeError(
          `Cache revalidation tag ${collection}.${index.toString()} must be an enumerable data element.`,
        );
      }
      assertTemplate(element.value, "tag");
      validatedTags.push(element.value);
    }
    validated[collection] = {
      paths,
      ...(rule.tags === undefined ? {} : { tags: validatedTags }),
    };
  }
  return validated;
}

function encodePathSegment(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

function substitute(template: string, ctx: SubstituteContext, kind: "path" | "tag"): string | null {
  let out = template;
  if (out.includes("{slug}")) {
    if (!ctx.documentSlug) return null;
    const slug = kind === "path" ? encodePathSegment(ctx.documentSlug) : ctx.documentSlug;
    if (slug === null) return null;
    out = out.replaceAll("{slug}", slug);
  }
  if (out.includes("{siteId}")) {
    if (!ctx.siteId) return null;
    out = out.replaceAll("{siteId}", ctx.siteId);
  }
  if (
    out.length >
      (kind === "path" ? npCacheContractLimits.pathLength : npCacheContractLimits.tagLength) ||
    (kind === "tag" && (hasControl(out) || /\s|[{}]/u.test(out)))
  ) {
    return null;
  }
  return out;
}

function collectTargets(
  rule: CollectionRevalidationRule,
  ctx: SubstituteContext,
): RevalidationTargets {
  const paths = rule.paths
    .map((template) => substitute(template, ctx, "path"))
    .filter((target): target is string => target !== null);
  const tags = (rule.tags ?? [])
    .map((template) => substitute(template, ctx, "tag"))
    .filter((target): target is string => target !== null);
  return { paths, tags };
}

/**
 * Awaitable collection invalidation. Site resolution, Next invalidation, and
 * downstream CDN purge complete before the exact outcome is returned.
 */
export async function revalidateCollection(
  rules: RevalidationMap,
  slug: string,
  doc?: Record<string, unknown> | null,
): Promise<NpCacheInvalidationResult> {
  const validatedRules = npRequireRevalidationMap(rules);
  const rule = validatedRules[slug] ?? { paths: [], tags: [] };
  const rawDocumentSlug =
    doc && typeof doc.slug === "string" && doc.slug.length > 0 ? doc.slug : undefined;
  const documentSlug =
    rawDocumentSlug !== undefined &&
    rawDocumentSlug.length <= npCacheContractLimits.identifierLength &&
    rawDocumentSlug === rawDocumentSlug.trim() &&
    !hasControl(rawDocumentSlug)
      ? rawDocumentSlug
      : undefined;
  let siteId: string | null;
  try {
    siteId = await getCurrentSiteId();
  } catch {
    siteId = null;
  }

  const targets = collectTargets(
    { paths: rule.paths, tags: [...(rule.tags ?? []), collectionCacheTag(slug)] },
    { documentSlug: rawDocumentSlug, siteId },
  );
  return invalidateCacheTargets({
    source: "collection",
    collection: slug,
    ...(documentSlug === undefined ? {} : { documentSlug }),
    siteId,
    paths: targets.paths,
    tags: targets.tags,
  });
}

/** Common defaults for the bundled blog and page routes. */
export const defaultRevalidationRules: RevalidationMap = npRequireRevalidationMap({
  posts: {
    paths: ["/blog", "/blog/{slug}"],
    tags: [
      "nx:posts",
      "nx:sitemap",
      "nx:feed:posts",
      "nx:search",
      "nx:sitemap:{siteId}",
      "nx:feed:{siteId}:posts",
      "nx:feed:{siteId}",
      "nx:search:{siteId}",
    ],
  },
  pages: {
    paths: ["/{slug}", "/"],
    tags: ["nx:pages", "nx:sitemap", "nx:search", "nx:sitemap:{siteId}", "nx:search:{siteId}"],
  },
});
