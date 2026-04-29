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
import {
  resolveAuthors,
  type AuthorResolution,
  type AuthorResolver,
} from "./authors.js";
import {
  emptyCommentPlan,
  importPostComments,
  type CommentDeps,
  type CommentImportPlan,
} from "./comments.js";
import {
  pickPostTermIds,
  resolveTaxonomies,
  type TaxonomyResolution,
  type TaxonomyResolver,
} from "./taxonomies.js";

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
 * Phase 21.6 layer: when a `taxonomies` resolver is supplied, the
 * applier resolves every WP `<category>` / `<post_tag>` term once
 * through the resolver and stamps the resulting NexPress term ids
 * onto each post's `categories` / `tags` relationship fields. The
 * reference app's shim points the resolver at a `taxonomies`
 * collection; user projects with their own taxonomy storage swap
 * in their own resolver. Without a resolver the applier records a
 * single notes line and posts go in without their terms wired.
 *
 * Phase 21.7 layer: when a `comments` deps object is supplied, the
 * applier walks each freshly created post's comments, find-or-
 * creates an `imported` member per author, and inserts each comment
 * directly into `nx_comments` via the deps. Spam/profanity adapters
 * and notification fan-out are bypassed — this is archived content,
 * not new community activity.
 *
 * Phase 21.8 layer: when an `authors` resolver is supplied, every
 * unique `<dc:creator>` login is resolved once into a NexPress
 * user id and stamped onto the post's `author` relationship field.
 * The shim's default resolver creates a `role: "viewer"` user with
 * a flagged email so the operator can promote them after the
 * import. The `--no-create-authors` opt-out swaps in a resolver
 * that returns `null` for every login — posts then go in without
 * an author and the import actor takes the credit via
 * `createdBy` / `updatedBy`.
 *
 * Out of scope here: custom post types (21.9). Records of those
 * types are still skipped with a one-line note in the report.
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
  /**
   * Phase 21.6 — when supplied, the applier resolves every WP
   * category/tag through this hook and stamps the resulting ids
   * onto post `categories` / `tags` fields. Omit to skip term
   * wiring (the report surfaces a one-line note about it).
   */
  taxonomies?: TaxonomyResolver;
  /**
   * Phase 21.7 — when supplied, every newly created post's WP
   * comments are imported as `nx_comments` rows, with imported
   * members find-or-created via the deps. Omit to skip comment
   * imports entirely.
   */
  comments?: CommentDeps;
  /**
   * Phase 21.8 — when supplied, the applier resolves each WP
   * author once and stamps the resulting NexPress user id onto
   * the post's `author` relationship field. Without it the
   * dropped-author note continues to surface and posts come in
   * without an author wired.
   */
  authors?: AuthorResolver;
}

export interface AppliedRow {
  wpId: number;
  wpType: string;
  collection: string;
  slug: string;
  title: string;
  /** Set when the post had a featured image and the applier wired `coverImage`. */
  coverImageId?: string;
  /** Phase 21.6 — taxonomy ids attached to this row's `categories` field. */
  categoryIds?: string[];
  /** Phase 21.6 — taxonomy ids attached to this row's `tags` field. */
  tagIds?: string[];
  /** Phase 21.8 — NexPress user id stamped onto the row's `author` field. */
  authorId?: string;
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
   * Phase 21.6 — resolved-taxonomy summary. `null` when the caller
   * didn't supply a `taxonomies` resolver. Useful for audits and
   * for the CLI to render the term-resolution outcome.
   */
  taxonomies: TaxonomyResolution | null;
  /** Phase 21.7 — comment import outcome. `null` when no comments deps. */
  comments: CommentImportPlan | null;
  /**
   * Phase 21.8 — resolved-author summary. `null` when the caller
   * didn't supply an `authors` resolver.
   */
  authors: AuthorResolution | null;
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

  let taxonomies: TaxonomyResolution | null = null;
  if (options.taxonomies && !dryRun) {
    taxonomies = await resolveTaxonomies(bundle.records, bundle.terms, options.taxonomies);
  }

  let authors: AuthorResolution | null = null;
  if (options.authors && !dryRun) {
    authors = await resolveAuthors(bundle, options.authors);
  }

  const commentsPlan: CommentImportPlan | null =
    options.comments && !dryRun ? emptyCommentPlan() : null;

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
      if (record.wpAuthorLogin && !authors?.authorIds.has(record.wpAuthorLogin)) {
        droppedAuthorCount++;
      }

      const coverImageId = resolveCoverImageId(record, resolution);
      if (collection === "posts") {
        if (coverImageId) {
          coverWiredCount++;
        } else if (recordHasFeaturedImage(record)) {
          coverMissingCount++;
        }
      }

      const termIds =
        collection === "posts" && taxonomies
          ? pickPostTermIds(record, taxonomies)
          : { categoryIds: [], tagIds: [] };
      const authorId =
        collection === "posts" && authors && record.wpAuthorLogin
          ? authors.authorIds.get(record.wpAuthorLogin) ?? undefined
          : undefined;

      if (dryRun) {
        applied.push({
          wpId: record.wpId,
          wpType: record.wpType,
          collection,
          slug: record.slug,
          title: record.title,
          coverImageId,
          categoryIds: termIds.categoryIds,
          tagIds: termIds.tagIds,
          authorId,
        });
        log(`plan  ${collection}/${record.slug}`);
        continue;
      }

      const data = buildDocData(record, resolution, collection, coverImageId, termIds, authorId);
      const saved = await saveDocument(collection, null, data, options.actor, {
        status: mapStatusToFramework(record.status),
      });
      applied.push({
        wpId: record.wpId,
        wpType: record.wpType,
        collection,
        slug: record.slug,
        title: record.title,
        coverImageId,
        categoryIds: termIds.categoryIds,
        tagIds: termIds.tagIds,
        authorId,
      });
      log(`write ${collection}/${record.slug}`);

      // Phase 21.7 — pull the post id from the save result and
      // walk this record's comments. Comments only land for posts
      // we just created — re-runs skip on slug collision and
      // therefore skip their archived comments too.
      if (commentsPlan && options.comments && collection === "posts") {
        const postId = typeof saved.doc.id === "string" ? saved.doc.id : null;
        if (postId) {
          await importPostComments({
            record,
            postId,
            collection,
            deps: options.comments,
            plan: commentsPlan,
            log,
          });
        }
      }
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
      authors
        ? `${droppedAuthorCount} record${droppedAuthorCount === 1 ? "" : "s"} dropped their original WP author (resolver returned null for the matching login).`
        : `${droppedAuthorCount} record${droppedAuthorCount === 1 ? "" : "s"} dropped their original WP author — opt in by passing \`authors\` to \`applyBundle\` (Phase 21.8).`,
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
  if (taxonomies) {
    if (taxonomies.errors.length > 0) {
      notes.push(
        `${taxonomies.errors.length} taxonomy term${taxonomies.errors.length === 1 ? "" : "s"} failed to resolve — see Taxonomies section.`,
      );
    }
    if (taxonomies.skipped.length > 0) {
      notes.push(
        `${taxonomies.skipped.length} taxonomy term${taxonomies.skipped.length === 1 ? "" : "s"} skipped by the resolver (likely a custom taxonomy the project doesn't track).`,
      );
    }
  } else if (hasAnyTerm(bundle)) {
    notes.push(
      "Categories/tags found in the WXR but no taxonomy resolver was supplied — terms were dropped (Phase 21.6 — opt in by passing `taxonomies` to `applyBundle`).",
    );
  }
  if (commentsPlan) {
    if (commentsPlan.skippedUnapproved > 0) {
      notes.push(
        `${commentsPlan.skippedUnapproved} comment${commentsPlan.skippedUnapproved === 1 ? "" : "s"} dropped because <wp:comment_approved> was not "1".`,
      );
    }
    if (commentsPlan.errors.length > 0) {
      notes.push(
        `${commentsPlan.errors.length} comment${commentsPlan.errors.length === 1 ? "" : "s"} failed to insert — see Comments section.`,
      );
    }
  } else if (hasAnyComment(bundle)) {
    notes.push(
      "Comments found in the WXR but no comments deps were supplied — comments were dropped (Phase 21.7 — opt in by passing `comments` to `applyBundle`).",
    );
  }

  if (authors) {
    if (authors.errors.length > 0) {
      notes.push(
        `${authors.errors.length} author${authors.errors.length === 1 ? "" : "s"} failed to resolve — see Authors section.`,
      );
    }
  }

  return {
    applied,
    skipped,
    errors,
    attachments,
    media,
    taxonomies,
    comments: commentsPlan,
    authors,
    notes,
  };
}

function buildDocData(
  record: WpImportRecord,
  resolution: MediaResolution,
  collection: string,
  coverImageId: string | undefined,
  termIds: { categoryIds: string[]; tagIds: string[] },
  authorId: string | undefined,
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
  if (collection === "posts") {
    if (termIds.categoryIds.length > 0) data.categories = termIds.categoryIds;
    if (termIds.tagIds.length > 0) data.tags = termIds.tagIds;
    if (authorId) data.author = authorId;
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

function hasAnyTerm(bundle: WpImportBundle): boolean {
  if (bundle.terms.length > 0) return true;
  return bundle.records.some((r) => r.terms.length > 0 && r.wpType !== "attachment");
}

function hasAnyComment(bundle: WpImportBundle): boolean {
  return bundle.records.some((r) => r.comments.length > 0 && r.wpType !== "attachment");
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
