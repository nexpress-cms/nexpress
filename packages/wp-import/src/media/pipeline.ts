import { createHash } from "node:crypto";

import type { AttachmentIndex } from "../apply/attachment-index.js";
import type { WpImportBundle } from "../parse/types.js";
import {
  downloadMedia,
  isAllowedMimeType,
  resolveEnvDownloadOptions,
  WpMediaDownloadError,
} from "./download.js";

/**
 * Phase 21.5 — orchestrates download + upload of every media URL the
 * import touches.
 *
 * Inputs are wired through `MediaPipelineDeps` rather than imported
 * directly so the unit tests don't need a DB or a network. The CLI
 * shim under `apps/web/scripts/wp-import.ts` plugs in the real
 * `uploadMedia` from `@nexpress/core`; tests pass an in-memory stub.
 *
 * Resolution map:
 *
 *   - `byUrl` — every successfully uploaded source URL → NexPress
 *     media id. Used to rewrite inline `<img>` src in Lexical.
 *   - `byAttachmentId` — WP attachment id → media id. Used by the
 *     applier for `_thumbnail_id` featured-image lookup.
 *
 * Phase 21.13 layered two prod-grade concerns on top:
 *
 *   - **Per-host concurrency cap.** Each unique URL host gets a
 *     small fixed-size queue (default 4) so a 50-image post on the
 *     same wp-content domain doesn't open 50 sockets in parallel.
 *     URLs from different hosts run independently.
 *   - **Cross-run hash dedup.** When the caller supplies
 *     `findExistingByHash`, the pipeline computes the SHA-256 of
 *     the downloaded bytes and looks the row up by hash before
 *     uploading. Re-running the importer against the same WXR
 *     therefore reuses existing `np_media` rows instead of
 *     producing byte-identical duplicates.
 */

export interface MediaUploadInput {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
}

export interface MediaPipelineDeps {
  /** Fetch the bytes for a source URL. Defaults to `downloadMedia`. */
  download?: (url: string) => Promise<{ buffer: Buffer; mimeType: string; filename: string }>;
  /**
   * Push a downloaded blob through the framework's media service.
   * Returns the new media row id.
   */
  upload: (input: MediaUploadInput) => Promise<{ id: string }>;
  /**
   * Phase 21.13 — when supplied, the pipeline asks the caller to
   * look up an existing `np_media` row by SHA-256 hash before
   * uploading. Returning a row reuses it (cross-run idempotency);
   * returning null falls through to upload as normal.
   */
  findExistingByHash?: (sha256: string) => Promise<{ id: string } | null>;
}

export interface MediaResolution {
  byUrl: Map<string, string>;
  byAttachmentId: Map<number, string>;
}

export interface MediaPipelineError {
  url: string;
  reason: string;
}

export interface MediaPipelineReport {
  resolution: MediaResolution;
  uploaded: number;
  skipped: number;
  /** Phase 21.13 — count of URLs whose bytes matched an existing media row. */
  reused: number;
  errors: MediaPipelineError[];
}

export interface MediaPipelineOptions {
  /** Set true to walk URLs without downloading or uploading anything. */
  dryRun?: boolean;
  /** Optional progress sink. */
  log?: (line: string) => void;
  /**
   * Phase 21.13 — concurrent-download cap per source-URL host.
   * Default 4 mirrors the design doc §6 recommendation; tests pass
   * 1 to keep ordering deterministic.
   */
  perHostConcurrency?: number;
}

const DEFAULT_PER_HOST_CONCURRENCY = 4;

/**
 * Walk every record's media refs + the attachment index, fetch each
 * unique URL once, and stamp the new media id back into the
 * resolution map.
 *
 * The pipeline is best-effort: a single 404 doesn't abort the run.
 * The error list surfaces what was missed so the operator can chase
 * it up. Callers (the applier) treat unresolved URLs as "leave the
 * Lexical src as-is and render a broken link" — same as design §6.
 */
export async function runMediaPipeline(
  bundle: WpImportBundle,
  attachments: AttachmentIndex,
  deps: MediaPipelineDeps,
  options: MediaPipelineOptions = {},
): Promise<MediaPipelineReport> {
  const log = options.log ?? noop;
  const dryRun = options.dryRun ?? false;
  // The default download honours NP_WP_IMPORT_ALLOW_PRIVATE_HOSTS and
  // NP_WP_IMPORT_MAX_BYTES so self-hosted operators can opt into
  // private-network sources without having to inject `deps.download`.
  // Resolve once per pipeline run so a single env read covers every
  // target — re-reading per URL would only reward someone toggling env
  // mid-run, which is not a real workflow.
  const envDefaults = resolveEnvDownloadOptions();
  const download = deps.download ?? ((url: string) => downloadMedia(url, envDefaults));
  const concurrency = Math.max(1, options.perHostConcurrency ?? DEFAULT_PER_HOST_CONCURRENCY);

  const byUrl = new Map<string, string>();
  const byAttachmentId = new Map<number, string>();
  const errors: MediaPipelineError[] = [];
  let uploaded = 0;
  let skipped = 0;
  let reused = 0;

  // Build a unique list of {url, wpAttachmentId} pairs to fetch.
  const targets = collectTargets(bundle, attachments);

  // Surface missing-attachment errors up front; they don't go through
  // the per-host queue (no URL to fetch).
  const fetchable: MediaTarget[] = [];
  for (const target of targets) {
    if (!target.url) {
      errors.push({
        url: `(wp-attachment-id ${target.wpAttachmentId})`,
        reason: "attachment record missing from WXR — cannot resolve URL",
      });
      continue;
    }
    fetchable.push(target);
  }

  // Group remaining targets by host so we can rate-limit per-host
  // concurrency without throttling cross-host fan-out. Targets with
  // an unparseable URL fall into a synthetic "(invalid)" bucket so
  // they don't block other hosts; their failures surface as normal
  // per-target errors.
  const byHost = new Map<string, MediaTarget[]>();
  for (const target of fetchable) {
    const host = parseHost(target.url);
    const list = byHost.get(host);
    if (list) list.push(target);
    else byHost.set(host, [target]);
  }

  // For each host, run a small fixed-size worker pool over its
  // targets; promise-merge across hosts so distinct hosts download
  // concurrently. The processing function below mutates the shared
  // resolution + counters.
  const processOne = async (target: MediaTarget): Promise<void> => {
    if (byUrl.has(target.url)) {
      if (target.wpAttachmentId !== null) {
        byAttachmentId.set(target.wpAttachmentId, byUrl.get(target.url)!);
      }
      return;
    }
    if (dryRun) {
      log(`media plan  ${target.url}`);
      skipped++;
      return;
    }
    try {
      const result = await download(target.url);
      if (!isAllowedMimeType(result.mimeType)) {
        errors.push({
          url: target.url,
          reason: `disallowed MIME type "${result.mimeType}"`,
        });
        return;
      }
      // Phase 21.13 — hash-based cross-run dedup. Compute the
      // canonical SHA-256 of the bytes (same algorithm `uploadMedia`
      // uses internally) and ask the caller whether a matching row
      // already exists. The hook is optional so tests can still run
      // without a DB.
      let mediaId: string | null = null;
      if (deps.findExistingByHash) {
        const sha256 = createHash("sha256").update(result.buffer).digest("hex");
        const existing = await deps.findExistingByHash(sha256);
        if (existing) {
          mediaId = existing.id;
          reused++;
          log(`media reuse ${target.url} → ${existing.id}`);
        }
      }
      if (!mediaId) {
        const upload = await deps.upload({
          buffer: result.buffer,
          originalFilename: result.filename,
          mimeType: result.mimeType,
        });
        mediaId = upload.id;
        uploaded++;
        log(`media write ${target.url} → ${upload.id}`);
      }
      byUrl.set(target.url, mediaId);
      if (target.wpAttachmentId !== null) {
        byAttachmentId.set(target.wpAttachmentId, mediaId);
      }
    } catch (err) {
      const reason =
        err instanceof WpMediaDownloadError
          ? err.status !== null
            ? `HTTP ${err.status}: ${err.message}`
            : err.message
          : err instanceof Error
            ? err.message
            : String(err);
      errors.push({ url: target.url, reason });
      log(`media error ${target.url}: ${reason}`);
    }
  };

  // Run each host's queue in order with a fixed worker pool of
  // `concurrency` workers. Within a host we pop targets off a shared
  // queue; across hosts the runs proceed in parallel via Promise.all.
  await Promise.all(
    Array.from(byHost.entries()).map(async ([_host, queue]) => {
      let cursor = 0;
      const next = async (): Promise<void> => {
        while (cursor < queue.length) {
          const i = cursor++;
          const target = queue[i];
          if (target) await processOne(target);
        }
      };
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => next());
      await Promise.all(workers);
    }),
  );

  return {
    resolution: { byUrl, byAttachmentId },
    uploaded,
    skipped,
    reused,
    errors,
  };
}

interface MediaTarget {
  url: string;
  wpAttachmentId: number | null;
}

/**
 * Build the unique list of URLs to fetch. The same physical asset
 * can show up in three places — the standalone attachment record,
 * the post's `_thumbnail_id` featured-image meta, and inline `<img>`
 * tags in the body — so we de-dupe by URL once we've resolved every
 * featured-image attachment id back to its source URL.
 */
function collectTargets(bundle: WpImportBundle, attachments: AttachmentIndex): MediaTarget[] {
  const seen = new Set<string>();
  const targets: MediaTarget[] = [];

  // 1. Every attachment record's source URL — covers the case where
  //    a post's _thumbnail_id points at an attachment whose URL
  //    isn't quoted in any post body.
  for (const entry of attachments.byId.values()) {
    if (!entry.sourceUrl) continue;
    if (seen.has(entry.sourceUrl)) continue;
    seen.add(entry.sourceUrl);
    targets.push({ url: entry.sourceUrl, wpAttachmentId: entry.wpAttachmentId });
  }

  // 2. Every post's media refs — captures inline <img> src URLs
  //    that the author may have hand-pasted (no attachment record).
  //    Featured-image refs without a sourceUrl resolve through
  //    `attachments.byId`; we surface a synthetic target with empty
  //    URL so the pipeline can record the missing-attachment error.
  for (const record of bundle.records) {
    if (record.wpType === "attachment") continue;
    for (const ref of record.mediaRefs) {
      if (ref.kind === "featured" && ref.wpAttachmentId !== null) {
        const entry = attachments.byId.get(ref.wpAttachmentId);
        const url = entry?.sourceUrl ?? "";
        if (url && seen.has(url)) continue;
        if (url) seen.add(url);
        targets.push({ url, wpAttachmentId: ref.wpAttachmentId });
        continue;
      }
      if (ref.sourceUrl && !seen.has(ref.sourceUrl)) {
        seen.add(ref.sourceUrl);
        targets.push({ url: ref.sourceUrl, wpAttachmentId: ref.wpAttachmentId });
      }
    }
  }

  return targets;
}

function parseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid)";
  }
}

function noop(): void {
  /* default log sink */
}
