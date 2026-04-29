import type { AttachmentIndex } from "../apply/attachment-index.js";
import type { WpImportBundle } from "../parse/types.js";
import { downloadMedia, isAllowedMimeType, WpMediaDownloadError } from "./download.js";

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
 * Within-run dedupe: the same source URL appearing on two records
 * downloads + uploads exactly once. Cross-run dedupe (re-running the
 * importer against the same WXR + same DB) lands in 21.10 with the
 * resume marker; for now the second run will create new rows.
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
  errors: MediaPipelineError[];
}

export interface MediaPipelineOptions {
  /** Set true to walk URLs without downloading or uploading anything. */
  dryRun?: boolean;
  /** Optional progress sink. */
  log?: (line: string) => void;
}

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
  const download = deps.download ?? ((url: string) => downloadMedia(url));

  const byUrl = new Map<string, string>();
  const byAttachmentId = new Map<number, string>();
  const errors: MediaPipelineError[] = [];
  let uploaded = 0;
  let skipped = 0;

  // Build a unique list of {url, wpAttachmentId} pairs to fetch.
  const targets = collectTargets(bundle, attachments);

  for (const target of targets) {
    if (!target.url) {
      // Featured-image references that point at an attachment id we
      // never saw an attachment record for. Nothing to download.
      errors.push({
        url: `(wp-attachment-id ${target.wpAttachmentId})`,
        reason: "attachment record missing from WXR — cannot resolve URL",
      });
      continue;
    }
    if (byUrl.has(target.url)) {
      // Already resolved by an earlier target sharing the same URL.
      // Mirror the id onto byAttachmentId if this target carried one.
      if (target.wpAttachmentId !== null) {
        byAttachmentId.set(target.wpAttachmentId, byUrl.get(target.url)!);
      }
      continue;
    }

    if (dryRun) {
      log(`media plan  ${target.url}`);
      // We can't allocate a real id without a DB write; leave the
      // resolution maps empty for the URL so the applier doesn't
      // rewrite Lexical to point at a phantom id.
      skipped++;
      continue;
    }

    try {
      const result = await download(target.url);
      if (!isAllowedMimeType(result.mimeType)) {
        errors.push({
          url: target.url,
          reason: `disallowed MIME type "${result.mimeType}"`,
        });
        continue;
      }
      const upload = await deps.upload({
        buffer: result.buffer,
        originalFilename: result.filename,
        mimeType: result.mimeType,
      });
      byUrl.set(target.url, upload.id);
      if (target.wpAttachmentId !== null) {
        byAttachmentId.set(target.wpAttachmentId, upload.id);
      }
      uploaded++;
      log(`media write ${target.url} → ${upload.id}`);
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
  }

  return {
    resolution: { byUrl, byAttachmentId },
    uploaded,
    skipped,
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

function noop(): void {
  /* default log sink */
}
