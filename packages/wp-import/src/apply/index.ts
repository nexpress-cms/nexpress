import { findDocuments, saveDocument } from "@nexpress/core";
import type { NxAuthUser } from "@nexpress/core";

import { htmlToLexical } from "../convert/html-to-lexical.js";
import { type WpImportBundle, type WpImportRecord, type WpPostStatus } from "../parse/types.js";
import { type AttachmentIndex, buildAttachmentIndex } from "./attachment-index.js";

/**
 * Phase 21.4 — write posts and pages from a parsed bundle into
 * NexPress collections via the framework's `saveDocument` pipeline.
 *
 * Scope kept tight on purpose:
 *
 *   - **In**: post + page records, with title / slug / content /
 *     excerpt / status / publishedAt mapped to the framework's
 *     own collection fields. Idempotent on slug — re-running with
 *     the same WXR is a no-op for already-imported entries.
 *   - **Out**: author wiring (Phase 21.8), media download
 *     (Phase 21.5), tags/categories (21.6), comments (21.7),
 *     custom post types (21.9). Records of those types are
 *     skipped here with a one-line note in the report; the
 *     bundle is preserved so later sub-phases can revisit.
 */

export interface ApplyOptions {
  /** Staff user that the import is attributed to. Required by `saveDocument`. */
  actor: NxAuthUser;
  /** Set true for a dry run — counts what would happen without writing. */
  dryRun?: boolean;
  /** Optional sink for per-record progress messages. Defaults to no-op. */
  log?: (line: string) => void;
}

export interface AppliedRow {
  wpId: number;
  wpType: string;
  collection: string;
  slug: string;
  title: string;
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

  const applied: AppliedRow[] = [];
  const skipped: SkippedRow[] = [];
  const errors: Array<{ wpId: number; slug: string; message: string }> = [];
  let privateCount = 0;
  let pendingCount = 0;
  let droppedAuthorCount = 0;

  for (const record of bundle.records) {
    const collection = TYPE_TO_COLLECTION[record.wpType];
    if (!collection) {
      skipped.push({
        wpId: record.wpId,
        wpType: record.wpType,
        slug: record.slug,
        reason:
          record.wpType === "attachment"
            ? "attachment — handled by 21.5 media pipeline"
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

      if (dryRun) {
        applied.push({
          wpId: record.wpId,
          wpType: record.wpType,
          collection,
          slug: record.slug,
          title: record.title,
        });
        log(`plan  ${collection}/${record.slug}`);
        continue;
      }

      await saveDocument(collection, null, buildDocData(record), options.actor, {
        status: mapStatusToFramework(record.status),
      });
      applied.push({
        wpId: record.wpId,
        wpType: record.wpType,
        collection,
        slug: record.slug,
        title: record.title,
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

  return { applied, skipped, errors, attachments, notes };
}

function buildDocData(record: WpImportRecord): Record<string, unknown> {
  const data: Record<string, unknown> = {
    title: record.title || "(untitled)",
    slug: record.slug,
    content: htmlToLexical(record.rawContent),
  };
  if (record.excerpt) {
    data.excerpt = record.excerpt;
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

function mapStatusToFramework(status: WpPostStatus): "draft" | "published" {
  // Only "publish" lands as published. "private" coerces to draft
  // per design doc §11.5 (we don't have per-doc visibility yet);
  // "pending" / "draft" stay as draft.
  return status === "publish" ? "published" : "draft";
}

function noop(): void {
  /* default log sink */
}
