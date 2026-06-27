import { getLogger } from "@nexpress/core";
import { revalidatePath, revalidateTag } from "next/cache";

export type NpCdnPurgeSource =
  | "collection"
  | "navigation"
  | "plugin-config"
  | "setup"
  | "site"
  | "theme"
  | "theme-settings";

export interface NpCdnPurgeRequest {
  readonly source: NpCdnPurgeSource;
  readonly collection?: string;
  readonly documentSlug?: string;
  readonly navigationLocation?: string;
  readonly pluginId?: string;
  readonly siteId: string | null;
  readonly themeId?: string;
  readonly paths: readonly string[];
  readonly tags: readonly string[];
}

export type NpCacheInvalidationPathType = "layout" | "page";

export interface NpCacheInvalidationPath {
  readonly path: string;
  readonly type?: NpCacheInvalidationPathType;
}

export type NpCacheInvalidationPathInput = string | NpCacheInvalidationPath;

export interface NpCacheInvalidationRequest extends Omit<NpCdnPurgeRequest, "paths" | "tags"> {
  readonly paths?: readonly NpCacheInvalidationPathInput[];
  readonly tags?: readonly string[];
}

export interface NpCdnPurgeAdapter {
  /**
   * Purge downstream CDN entries after NexPress has emitted the matching
   * Next.js `revalidatePath` / `revalidateTag` calls.
   *
   * Implementations should treat `paths` and `tags` as hints: providers
   * differ in whether they support tag purges, URL purges, or both.
   */
  purge(request: NpCdnPurgeRequest): void | Promise<void>;
}

let adapter: NpCdnPurgeAdapter | null = null;

export function setCdnPurgeAdapter(next: NpCdnPurgeAdapter | null): void {
  if (next !== null && typeof next.purge !== "function") {
    throw new Error("setCdnPurgeAdapter: adapter must implement purge()");
  }
  adapter = next;
}

export function getCdnPurgeAdapter(): NpCdnPurgeAdapter | null {
  return adapter;
}

export function resetCdnPurgeAdapter(): void {
  adapter = null;
}

export function invalidateCacheTargets(request: NpCacheInvalidationRequest): void {
  const pathTargets = uniquePathTargets(request.paths ?? []);
  const tags = unique(request.tags ?? []);

  for (const tag of tags) {
    try {
      revalidateTag(tag, "default");
    } catch (error) {
      logNextInvalidationFailure("tag", tag, error, request);
    }
  }

  for (const target of pathTargets) {
    try {
      if (target.type) {
        revalidatePath(target.path, target.type);
      } else {
        revalidatePath(target.path);
      }
    } catch (error) {
      logNextInvalidationFailure("path", target.path, error, request);
    }
  }

  purgeCdnCache({
    ...request,
    paths: pathTargets.map((target) => target.path),
    tags,
  });
}

export function purgeCdnCache(request: NpCdnPurgeRequest): void {
  const current = adapter;
  if (!current) return;

  const normalized = normalizeRequest(request);
  if (normalized.paths.length === 0 && normalized.tags.length === 0) return;

  try {
    void Promise.resolve(current.purge(normalized)).catch((error: unknown) => {
      logPurgeFailure(error, normalized);
    });
  } catch (error) {
    logPurgeFailure(error, normalized);
  }
}

function normalizeRequest(request: NpCdnPurgeRequest): NpCdnPurgeRequest {
  return {
    ...request,
    paths: unique(request.paths),
    tags: unique(request.tags),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniquePathTargets(
  values: readonly NpCacheInvalidationPathInput[],
): NpCacheInvalidationPath[] {
  const seen = new Set<string>();
  const targets: NpCacheInvalidationPath[] = [];

  for (const value of values) {
    const target = typeof value === "string" ? { path: value } : value;
    const key = `${target.path}\0${target.type ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }

  return targets;
}

function logNextInvalidationFailure(
  kind: "path" | "tag",
  target: string,
  error: unknown,
  request: NpCacheInvalidationRequest,
): void {
  if (process.env.NODE_ENV === "test") return;
  getLogger().warn("cache invalidation skipped", {
    source: request.source,
    target,
    kind,
    collection: request.collection,
    documentSlug: request.documentSlug,
    navigationLocation: request.navigationLocation,
    pluginId: request.pluginId,
    siteId: request.siteId,
    themeId: request.themeId,
    error: error instanceof Error ? error.message : String(error),
  });
}

function logPurgeFailure(error: unknown, request: NpCdnPurgeRequest): void {
  if (process.env.NODE_ENV === "test") return;
  getLogger().warn("CDN cache purge failed", {
    source: request.source,
    collection: request.collection,
    documentSlug: request.documentSlug,
    navigationLocation: request.navigationLocation,
    pluginId: request.pluginId,
    siteId: request.siteId,
    themeId: request.themeId,
    paths: request.paths,
    tags: request.tags,
    error: error instanceof Error ? error.message : String(error),
  });
}
