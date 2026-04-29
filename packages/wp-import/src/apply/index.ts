import { findDocuments, saveDocument } from "@nexpress/core";
import type { NxAuthUser } from "@nexpress/core";

import { htmlToLexical, type LexicalRoot } from "../convert/html-to-lexical.js";
import {
  type MediaPipelineDeps,
  type MediaPipelineReport,
  type MediaResolution,
  runMediaPipeline,
} from "../media/pipeline.js";
import { rewriteLexicalMedia } from "../media/rewrite.js";
import { type WpImportBundle, type WpImportRecord, type WpPostStatus } from "../parse/types.js";
import { type AttachmentIndex, buildAttachmentIndex } from "./attachment-index.js";

/**
 * Phase 21.4 — write posts and pages from a parsed bundle into
 * NexPress collections via the framework's `saveDocument` pipeline.
 *
 * Phase 21.5 layer: when a `media` deps object is supplied, the
 * applier first walks every attachment + inline `<img>` URL through
 * the media download/upload pipeline. The resulting URL → media-id
 * map is then stitched into Lexical body content and the post's
 * `coverImage` upload field. Without `media.deps` the applier still
 * runs end-to-end, but image refs render as raw source-URL `<img>`
 * tags (the pre-21.5 behavior).
 *
 * Out of scope here: author wiring (21.8), tags/categories (21.6),
 * comments (21.7), custom post types (21.9). Records of those types
 * are still skipped with a one-line note in the report.
 */

export interface ApplyOptions {
  /** Staff user that the import is attributed to. Required by `saveDocument`. */
  actor: NxAuthUser;
  /** Set true for a dry run — counts what would happen without writing. */
  dryRun?: boolean;
  /** Optional sink for per-record progress messages. Defaults to no-op. */
  log?: (line: string) => void;
  /**
   * When supplied, runs the Phase 21.5 media pipeline before writing
   * any record. Omit to skip media handling entirely (the applier
   * leaves Lexical image src as the original WP URL).
   */
  media?: MediaPipelineDeps;
}

export interface AppliedRow {
  wpId: number;
  wpType: string;
  collection: string;
  slug: string;
  title: string;
  /** Set when the post had a featured image and the applier wired `coverImage`. */
  coverImageId?: string;
}

export interface SkippedRow {
  wpId: number;
  wpType: string;
  slug: string;
  reason: string;
}

export interface ApplyReport {
  applied: AppliedRow[];
  skipped: SkippedRow[];
  errors: Array<{ wpId: number; slug: string; message: string }>;
  /**
   * Attachment index built during apply. Phase 21.5 picks it up
   * to drive the media download/upload pipeline; surfaces here so
   * the CLI can show a meaningful summary even on a dry run.
   */
  attachments: AttachmentIndex;
  /**
   * Phase 21.5 media-pipeline summary. `null` when the caller did
   * not supply a `media` deps object — the report still renders
   * cleanly with a "media pipeline not run" line.
   */
  media: MediaPipelineReport | null;
  /**
   * One-time observations the operator should know about — drops
   * we made silently per-record but want surfaced once aggregated.
   * Examples: original authors dropped (21.8), `private` status
   * coerced to draft (design §11.5).
   */
  notes: string[];
}

const TYPE_TO_COLLECTION: Readonly<Record<string, string>> = {
  post: "posts",
  page: "pages",
};

export async function applyBundle(
  bundle: WpImportBundle,
  options: ApplyOptions,
): Promise<ApplyReport> {
  const log = options.log ?? noop;
  const dryRun = options.dryRun ?? false;
  const attachments = buildAttachmentIndex(bundle);

  let media: MediaPipelineReport | null = null;
  let resolution: MediaResolution = { byUrl: new Map(), byAttachmentId: new Map() };
  if (options.media) {
    media = await runMediaPipeline(bundle, attachments, options.media, { dryRun, log });
    resolution = media.resolution;
  }

  const applied: AppliedRow[] = [];
  const skipped: SkippedRow[] = [];
  const errors: Array<{ wpId: number; slug: string; message: string }> = [];
  let privateCount = 0;
  let pendingCount = 0;
  let droppedAuthorCount = 0;
  let coverWiredCount = 0;
  let coverMissingCount = 0;

  for (const record of bundle.records) {
    const collection = TYPE_TO_COLLECTION[record.wpType];
    if (!collection) {
      skipped.push({
        wpId: record.wpId,
        wpType: record.wpType,
        slug: record.slug,
        reason:
          record.wpType === "attachment"
            ? "attachment — handled by media pipeline"
            : `unmapped wpType "${record.wpType}" (custom post types land in 21.9)`,
      });
      continue;
    }

    if (record.status === "trash" || record.status === "auto-draft") {
      skipped.push({
        wpId: record.wpId,
        wpType: record.wpType,
        slug: record.slug,
        reason: `status="${record.status}"`,
      });
      continue;
    }

    if (!record.slug) {
      skipped.push({
        wpId: record.wpId,
        wpType: record.wpType,
        slug: "",
        reason: "missing slug",
      });
      continue;
    }

    try {
      const exists = await findDocuments(
        collection,
        { where: { slug: record.slug }, limit: 1 },
        options.actor,
      );
      if (exists.docs.length > 0) {
        skipped.push({
          wpId: record.wpId,
          wpType: record.wpType,
          slug: record.slug,
          reason: "slug already exists",
        });
        log(`skip  ${collection}/${record.slug} (already exists)`);
        continue;
      }

      if (record.status === "private") privateCount++;
      else if (record.status === "pending") pendingCount++;
      if (record.wpAuthorLogin) droppedAuthorCount++;

      const coverImageId = resolveCoverImageId(record, resolution);
      if (collection === "posts") {
        if (coverImageId) {
          coverWiredCount++;
        } else if (recordHasFeaturedImage(record)) {
          coverMissingCount++;
        }
      }

      if (dryRun) {
        applied.push({
          wpId: record.wpId,
          wpType: record.wpType,
          collection,
          slug: record.slug,
          title: record.title,
          coverImageId,
        });
        log(`plan  ${collection}/${record.slug}`);
        continue;
      }

      const data = buildDocData(record, resolution, collection, coverImageId);
      await saveDocument(collection, null, data, options.actor, {
        status: mapStatusToFramework(record.status),
      });
      applied.push({
        wpId: record.wpId,
        wpType: record.wpType,
        collection,
        slug: record.slug,
        title: record.title,
        coverImageId,
      });
      log(`write ${collection}/${record.slug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ wpId: record.wpId, slug: record.slug, message });
      log(`error ${collection}/${record.slug}: ${message}`);
    }
  }

  const notes: string[] = [];
  if (privateCount > 0) {
    notes.push(
      `${privateCount} record${privateCount === 1 ? "" : "s"} with WP status "private" imported as draft (design §11.5 — per-doc visibility is a separate phase).`,
    );
  }
  if (pendingCount > 0) {
    notes.push(
      `${pendingCount} record${pendingCount === 1 ? "" : "s"} with WP status "pending" imported as draft.`,
    );
  }
  if (droppedAuthorCount > 0) {
    notes.push(
      `${droppedAuthorCount} record${droppedAuthorCount === 1 ? "" : "s"} dropped their original WP author (Phase 21.8 wires authorship; today imports are attributed to the import operator).`,
    );
  }
  if (coverWiredCount > 0) {
    notes.push(
      `${coverWiredCount} post${coverWiredCount === 1 ? "" : "s"} wired a featured image to coverImage from the WP _thumbnail_id reference.`,
    );
  }
  if (coverMissingCount > 0) {
    notes.push(
      `${coverMissingCount} post${coverMissingCount === 1 ? "" : "s"} declared a WP featured image but the source asset was not resolvable (download failed, MIME rejected, or attachment record missing).`,
    );
  }

  return { applied, skipped, errors, attachments, media, notes };
}

function buildDocData(
  record: WpImportRecord,
  resolution: MediaResolution,
  collection: string,
  coverImageId: string | undefined,
): Record<string, unknown> {
  const lexical = htmlToLexical(record.rawContent);
  const rewritten: LexicalRoot = rewriteLexicalMedia(lexical, resolution);
  const data: Record<string, unknown> = {
    title: record.title || "(untitled)",
    slug: record.slug,
    content: rewritten,
  };
  if (record.excerpt) {
    data.excerpt = record.excerpt;
  }
  if (collection === "posts" && coverImageId) {
    data.coverImage = coverImageId;
  }
  // <wp:post_date_gmt> arrives as "YYYY-MM-DD HH:mm:ss" without a
  // timezone marker. Treat as UTC (the GMT in the tag name is
  // explicit). publishedAt is required for the posts collection's
  // sort-by-date archive pages; pages don't render it but the
  // field is harmless to set.
  if (record.publishedAt) {
    const iso = record.publishedAt.replace(" ", "T") + "Z";
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      data.publishedAt = date.toISOString();
    }
  }
  return data;
}

function recordHasFeaturedImage(record: WpImportRecord): boolean {
  return record.mediaRefs.some((ref) => ref.kind === "featured");
}

/**
 * Look up the cover image media id for a record. Returns undefined
 * when the record didn't declare one or when the pipeline couldn't
 * resolve it (download 404, MIME rejected, attachment record
 * missing).
 */
function resolveCoverImageId(
  record: WpImportRecord,
  resolution: MediaResolution,
): string | undefined {
  const ref = record.mediaRefs.find((m) => m.kind === "featured");
  if (!ref) return undefined;
  if (ref.wpAttachmentId !== null) {
    const id = resolution.byAttachmentId.get(ref.wpAttachmentId);
    if (id) return id;
  }
  if (ref.sourceUrl) {
    const id = resolution.byUrl.get(ref.sourceUrl);
    if (id) return id;
  }
  return undefined;
}

function mapStatusToFramework(status: WpPostStatus): "draft" | "published" {
  // Only "publish" lands as published. "private" coerces to draft
  // per design doc §11.5 (we don't have per-doc visibility yet);
  // "pending" / "draft" stay as draft.
  return status === "publish" ? "published" : "draft";
}

function noop(): void {
  /* default log sink */
}
