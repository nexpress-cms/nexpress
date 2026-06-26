import { getLogger } from "@nexpress/core";

export interface NpCdnPurgeRequest {
  readonly source: "collection";
  readonly collection: string;
  readonly documentSlug?: string;
  readonly siteId: string | null;
  readonly paths: readonly string[];
  readonly tags: readonly string[];
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

function logPurgeFailure(error: unknown, request: NpCdnPurgeRequest): void {
  if (process.env.NODE_ENV === "test") return;
  getLogger().warn("CDN cache purge failed", {
    source: request.source,
    collection: request.collection,
    documentSlug: request.documentSlug,
    siteId: request.siteId,
    paths: request.paths,
    tags: request.tags,
    error: error instanceof Error ? error.message : String(error),
  });
}
