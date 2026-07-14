import {
  npCdnPurgeAdapterKind,
  npRequireCdnPurgeAdapter,
  npRunCacheInvalidation,
  type NpCacheInvalidationAdapter,
  type NpCacheInvalidationCdnResult,
  type NpCacheInvalidationRequest,
  type NpCacheInvalidationResult,
  type NpCacheInvalidationSource,
  type NpCdnPurgeAdapter,
  type NpCdnPurgeRequest,
  type NpNormalizedCacheInvalidationRequest,
} from "@nexpress/core/cache";
import { getLogger } from "@nexpress/core/observability";
import { revalidatePath, revalidateTag } from "next/cache";

export type {
  NpCacheInvalidationPath,
  NpCacheInvalidationPathInput,
  NpCacheInvalidationPathType,
  NpCacheInvalidationRequest,
  NpCacheInvalidationResult,
  NpCdnPurgeAdapter,
  NpCdnPurgeRequest,
} from "@nexpress/core/cache";

/** Compatibility alias retained for existing `@nexpress/next` consumers. */
export type NpCdnPurgeSource = NpCacheInvalidationSource;

let adapter: NpCdnPurgeAdapter | null = null;

export function setCdnPurgeAdapter(next: NpCdnPurgeAdapter | null): void {
  adapter = next === null ? null : npRequireCdnPurgeAdapter(next);
}

export function getCdnPurgeAdapter(): NpCdnPurgeAdapter | null {
  return adapter;
}

export function resetCdnPurgeAdapter(expected?: NpCdnPurgeAdapter): void {
  if (expected === undefined || adapter === expected) adapter = null;
}

/** Detach before awaiting so a failed provider shutdown cannot leave a closed adapter installed. */
export async function shutdownCdnPurgeAdapter(expected?: NpCdnPurgeAdapter): Promise<void> {
  const current = adapter;
  const owned = expected ?? current;
  if (current === owned) adapter = null;
  if (!owned?.shutdown) return;
  const result: unknown = await owned.shutdown();
  if (result !== undefined) {
    throw new Error("CDN purge adapter shutdown() must resolve to void.");
  }
}

function targetResult(requested: number, failed: number) {
  return { requested, succeeded: requested - failed, failed };
}

function resolveStatus(
  pathFailures: number,
  tagFailures: number,
  totalTargets: number,
  cdn: NpCacheInvalidationCdnResult,
): NpCacheInvalidationResult["status"] {
  const nextFailures = pathFailures + tagFailures;
  if (nextFailures === 0 && cdn.status !== "failed") return "applied";
  const nextSuccesses = totalTargets - nextFailures;
  if (nextSuccesses > 0 || cdn.status === "applied") return "partial";
  return "unavailable";
}

async function executeNextInvalidation(
  request: NpNormalizedCacheInvalidationRequest,
): Promise<NpCacheInvalidationResult> {
  let tagFailures = 0;
  let pathFailures = 0;

  for (const tag of request.tags) {
    try {
      revalidateTag(tag, "default");
    } catch (error) {
      tagFailures += 1;
      logNextInvalidationFailure("tag", tag, error, request);
    }
  }

  for (const target of request.paths) {
    try {
      if (target.type) revalidatePath(target.path, target.type);
      else revalidatePath(target.path);
    } catch (error) {
      pathFailures += 1;
      logNextInvalidationFailure("path", target.path, error, request);
    }
  }

  const cdn = await purgeCdnCache({
    ...request,
    paths: [...new Set(request.paths.map((target) => target.path))],
  });
  return {
    status: resolveStatus(
      pathFailures,
      tagFailures,
      request.paths.length + request.tags.length,
      cdn,
    ),
    paths: targetResult(request.paths.length, pathFailures),
    tags: targetResult(request.tags.length, tagFailures),
    cdn,
  };
}

export const npNextCacheInvalidationAdapter: NpCacheInvalidationAdapter = {
  kind: "next",
  invalidate: executeNextInvalidation,
};

/** Validate, normalize, execute, await CDN completion, and return an exact outcome. */
export function invalidateCacheTargets(
  request: NpCacheInvalidationRequest,
): Promise<NpCacheInvalidationResult> {
  return npRunCacheInvalidation(npNextCacheInvalidationAdapter, request);
}

export async function purgeCdnCache(
  request: NpCdnPurgeRequest,
): Promise<NpCacheInvalidationCdnResult> {
  const current = adapter;
  if (!current) return { status: "not-configured", adapterKind: null };
  if (request.paths.length === 0 && request.tags.length === 0) {
    return { status: "skipped", adapterKind: null };
  }

  const adapterKind = npCdnPurgeAdapterKind(current);
  try {
    const result: unknown = await current.purge(request);
    if (result !== undefined) {
      throw new Error("CDN purge adapter purge() must resolve to void.");
    }
    return { status: "applied", adapterKind };
  } catch (error) {
    logPurgeFailure(error, request);
    return { status: "failed", adapterKind };
  }
}

function logNextInvalidationFailure(
  kind: "path" | "tag",
  target: string,
  error: unknown,
  request: NpNormalizedCacheInvalidationRequest,
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
    error: describeError(error),
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
    error: describeError(error),
  });
}

function describeError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "Unprintable cache invalidation failure.";
  }
}
