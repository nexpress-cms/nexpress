import { findDocuments, saveDocument } from "@nexpress/core";
import type { NpAuthUser } from "@nexpress/core";
import type { NpCommunityJsonObject } from "@nexpress/core/community-contract";

import {
  htmlToLexical,
  type LexicalConversionWarning,
  type LexicalRoot,
} from "../convert/html-to-lexical.js";
import {
  type MediaPipelineDeps,
  type MediaPipelineReport,
  type MediaResolution,
  runMediaPipeline,
} from "../media/pipeline.js";
import { rewriteLexicalMedia } from "../media/rewrite.js";
import { type WpImportBundle, type WpImportRecord, type WpPostStatus } from "../parse/types.js";
import { type AttachmentIndex, buildAttachmentIndex } from "./attachment-index.js";
import { resolveAuthors, type AuthorResolution, type AuthorResolver } from "./authors.js";
import {
  emptyCommentPlan,
  importPostComments,
  type CommentDeps,
  type CommentImportPlan,
} from "./comments.js";
import { documentKey, type ResumeDeps } from "./resume.js";
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
 * directly into `np_comments` via the deps. Spam/profanity adapters
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
  actor: NpAuthUser;
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
   * comments are imported as `np_comments` rows, with imported
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
  /**
   * Phase 21.9 — operator-supplied mapping table for custom WP
   * post types. Without an entry here the applier skips the
   * record with a warning. Keys are WP `<wp:post_type>` values
   * (e.g. `"product"`); values declare the NexPress collection to
   * route the record into and an optional `fieldOverrides` map
   * that maps WP post-meta keys onto NexPress collection field
   * names. Built-in post / page mappings are always applied first
   * and take precedence — this option only widens the routing
   * table, it doesn't override the defaults.
   */
  collectionMappings?: Record<string, CollectionMapping>;
  /**
   * Phase 21.10 — when supplied, the applier emits an audit event
   * for every document it writes (action `import.wp.applied`),
   * skips for already-imported slugs (`import.wp.skipped`), and
   * record-level errors (`import.wp.error`). The shim wires this
   * to `recordAuditEvent` from `@nexpress/core` so the entries
   * land in `np_audit_events` alongside the rest of the operator
   * trail. Audit failures NEVER abort the import — see the
   * deps's contract.
   */
  audit?: AuditDeps;
  /**
   * Phase 21.11 — when supplied, the applier writes the original
   * WP author display name (or login when no display name is set)
   * to the named field on every imported document, so the byline
   * is preserved even when `--no-create-authors` strips the
   * `np_users` link. Operators add a matching `text` field to
   * their collection and declare the mapping here, e.g.:
   *
   *   { posts: "wpOriginalAuthor" }
   *
   * Collections without an entry skip the field write — the
   * applier only touches columns the operator opted into, so
   * existing schemas keep round-tripping unchanged.
   */
  preserveOriginalAuthor?: Record<string, string>;
  /**
   * Phase 21.14 — when supplied, the applier reads + writes a
   * resume marker so re-runs skip work that already landed.
   * Documents are matched by `(collection, slug)`, comments by WP
   * comment id. The marker is persisted after each record-level
   * success; a crash mid-import resumes from the last persisted
   * row instead of starting over.
   */
  resume?: ResumeDeps;
  /**
   * Phase 21.12 — when true, the applier rewrites content for
   * documents whose slug already exists instead of skipping them.
   * The existing `np_c_*` row keeps its id (so revisions and
   * `np_media_refs` pointers stay intact); the `data` payload —
   * title, content, excerpt, coverImage, taxonomies, author,
   * publishedAt — is overwritten. Comments are NOT re-imported on
   * an update pass; existing rows under that document stay put.
   * Without the flag the historical skip-on-collision behavior
   * holds.
   */
  update?: boolean;
  /**
   * Phase 21.12 — when true, downstream warnings escalate to
   * `errors` so the CLI exits non-zero. Specifically: any media
   * pipeline error (4xx, MIME reject, missing attachment) and
   * any taxonomy / author resolver failure becomes a record-level
   * error rather than a soft note. Useful for migration scripts
   * that need a clean import or nothing — the operator wants the
   * pipeline to abort rather than silently skip an asset.
   */
  strict?: boolean;
  /**
   * Phase 21.12 — when supplied, the applier emits a side-by-side
   * conversion sample for every imported record so an operator can
   * spot-check the WP HTML → Lexical roundtrip. The deps object
   * receives the source content + the resulting Lexical AST; the
   * shim writes them out as an HTML diff page next to the WXR.
   */
  reportHtml?: ReportHtmlDeps;
}

export interface ReportHtmlDeps {
  emit: (sample: {
    wpId: number;
    wpType: string;
    slug: string;
    title: string;
    rawContent: string;
    lexical: LexicalRoot;
  }) => void;
}

export type NpWpImportAuditEvent = {
  action: string;
  payload?: NpCommunityJsonObject;
} & (
  | {
      targetType: string;
      targetId: string;
    }
  | {
      targetType?: never;
      targetId?: never;
    }
);

export interface AuditDeps {
  record: (event: NpWpImportAuditEvent) => Promise<void>;
}

export interface CollectionMapping {
  collection: string;
  /**
   * Maps WP `<wp:postmeta>` keys to NexPress collection field
   * names. Each mapped meta value is copied verbatim onto the
   * document data; values are not coerced (the framework's Zod
   * validation will reject mismatched types and surface a
   * per-record error in the report).
   */
  fieldOverrides?: Record<string, string>;
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
  const conversionWarningCounts = new Map<string, number>();

  for (const record of bundle.records) {
    const builtin = TYPE_TO_COLLECTION[record.wpType];
    const customMapping =
      !builtin && options.collectionMappings
        ? options.collectionMappings[record.wpType]
        : undefined;
    const collection = builtin ?? customMapping?.collection;
    if (!collection) {
      skipped.push({
        wpId: record.wpId,
        wpType: record.wpType,
        slug: record.slug,
        reason:
          record.wpType === "attachment"
            ? "attachment — handled by media pipeline"
            : `unmapped wpType "${record.wpType}" — add an entry to wp-import config to route it`,
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
      // Phase 21.14 — when a resume marker is present, the
      // (collection, slug) → id lookup is authoritative. Querying
      // the DB on every record adds a round trip per-record at
      // no benefit if the marker already says where the row lives.
      const markerId = options.resume?.state.documents[documentKey(collection, record.slug)];
      const exists = markerId
        ? { docs: [{ id: markerId }] }
        : await findDocuments(
            collection,
            { where: { slug: record.slug }, limit: 1 },
            options.actor,
          );
      const existingId =
        exists.docs.length > 0 &&
        typeof exists.docs[0]?.id === "string" &&
        exists.docs[0].id.trim().length > 0
          ? exists.docs[0]?.id
          : undefined;
      const updateMode = options.update === true && existingId !== undefined;
      if (exists.docs.length > 0 && !updateMode) {
        if (!existingId) {
          throw new Error(
            `Existing ${collection}/${record.slug} document did not expose a non-empty string id`,
          );
        }
        skipped.push({
          wpId: record.wpId,
          wpType: record.wpType,
          slug: record.slug,
          reason: markerId ? "resume marker — already imported" : "slug already exists",
        });
        log(
          `skip  ${collection}/${record.slug} (${markerId ? "resume marker" : "already exists"})`,
        );
        await emitAudit(options.audit, {
          action: "import.wp.skipped",
          targetType: collection,
          targetId: existingId,
          payload: {
            wpId: record.wpId,
            wpType: record.wpType,
            slug: record.slug,
            reason: markerId ? "resume marker" : "slug already exists",
          },
        });
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
          ? (authors.authorIds.get(record.wpAuthorLogin) ?? undefined)
          : undefined;

      if (dryRun) {
        const lexical = buildLexicalContent(record, resolution, (warning) =>
          collectConversionWarning(conversionWarningCounts, warning),
        );
        options.reportHtml?.emit({
          wpId: record.wpId,
          wpType: record.wpType,
          slug: record.slug,
          title: record.title,
          rawContent: record.rawContent,
          lexical,
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
        log(`plan  ${collection}/${record.slug}`);
        continue;
      }

      const originalAuthorField = options.preserveOriginalAuthor?.[collection];
      const originalAuthorName = originalAuthorField
        ? resolveOriginalAuthorName(record, bundle)
        : undefined;
      const data = buildDocData(
        record,
        resolution,
        collection,
        coverImageId,
        termIds,
        authorId,
        customMapping?.fieldOverrides,
        originalAuthorField && originalAuthorName
          ? { field: originalAuthorField, value: originalAuthorName }
          : undefined,
        (warning) => collectConversionWarning(conversionWarningCounts, warning),
      );
      const mappedStatus = mapStatusToFramework(record.status);
      const saved = await saveDocument(
        collection,
        updateMode && existingId ? existingId : null,
        // Phase 21.17 — visibility rides the data payload (it's a
        // collection column, validated by the Zod schema), while
        // status stays as the saveDocument opts override. Both
        // are derived from the WP record's `<wp:status>` here.
        { ...data, visibility: mappedStatus.visibility },
        options.actor,
        {
          status: mappedStatus.status,
        },
      );
      const savedId =
        typeof saved.doc.id === "string" && saved.doc.id.trim().length > 0
          ? saved.doc.id
          : undefined;
      if (!savedId) {
        throw new Error(
          `Saved ${collection}/${record.slug} document did not expose a non-empty string id`,
        );
      }
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
      log(
        updateMode ? `update ${collection}/${record.slug}` : `write ${collection}/${record.slug}`,
      );
      options.reportHtml?.emit({
        wpId: record.wpId,
        wpType: record.wpType,
        slug: record.slug,
        title: record.title,
        rawContent: record.rawContent,
        lexical: data.content as LexicalRoot,
      });
      await emitAudit(options.audit, {
        action: updateMode ? "import.wp.updated" : "import.wp.applied",
        targetType: collection,
        targetId: savedId,
        payload: {
          wpId: record.wpId,
          wpType: record.wpType,
          slug: record.slug,
          title: record.title,
          categoryIds: termIds.categoryIds,
          tagIds: termIds.tagIds,
          ...(coverImageId ? { coverImageId } : {}),
          ...(authorId ? { authorId } : {}),
        },
      });
      // Phase 21.14 — persist the marker after every successful
      // save so a crash mid-import resumes from the last persisted
      // row. Only `documents` is updated here; comments / media
      // are stamped into the marker by their respective passes.
      if (options.resume && savedId) {
        options.resume.state.documents[documentKey(collection, record.slug)] = savedId;
        await options.resume.persist();
      }

      // Phase 21.7 — pull the post id from the save result and
      // walk this record's comments. The resume marker (Phase
      // 21.14) makes the comment pass idempotent across re-runs;
      // on `--update` we still walk it so newly-added WP comments
      // land, but already-imported wpCommentIds are skipped.
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
            resume: options.resume,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ wpId: record.wpId, slug: record.slug, message });
      log(`error ${collection}/${record.slug}: ${message}`);
      await emitAudit(options.audit, {
        action: "import.wp.error",
        payload: {
          collection,
          wpId: record.wpId,
          wpType: record.wpType,
          slug: record.slug,
          message,
        },
      });
    }
  }

  const notes: string[] = [];
  if (privateCount > 0) {
    notes.push(
      `${privateCount} record${privateCount === 1 ? "" : "s"} with WP status "private" imported as published with visibility=private (Phase 21.17).`,
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
  for (const [message, count] of conversionWarningCounts) {
    notes.push(`${count} Gutenberg conversion warning${count === 1 ? "" : "s"}: ${message}`);
  }

  // Phase 21.12 — escalate sub-pipeline failures to record-level
  // errors when the operator passed `--strict`. The CLI exits
  // non-zero when `errors.length > 0`, so this turns a soft media
  // 404 / taxonomy collision / author-create failure into a
  // hard import abort signal.
  if (options.strict) {
    if (media) {
      for (const e of media.errors) {
        errors.push({ wpId: 0, slug: e.url, message: `media: ${e.reason}` });
      }
    }
    if (taxonomies) {
      for (const e of taxonomies.errors) {
        errors.push({
          wpId: 0,
          slug: `${e.key.taxonomy}/${e.key.slug}`,
          message: `taxonomy: ${e.reason}`,
        });
      }
    }
    if (authors) {
      for (const e of authors.errors) {
        errors.push({ wpId: 0, slug: e.login, message: `author: ${e.reason}` });
      }
    }
    if (commentsPlan) {
      for (const e of commentsPlan.errors) {
        errors.push({
          wpId: 0,
          slug: `comment#${e.wpCommentId}`,
          message: `comment: ${e.reason}`,
        });
      }
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
  fieldOverrides: Record<string, string> | undefined,
  originalAuthor: { field: string; value: string } | undefined,
  onConversionWarning?: (warning: LexicalConversionWarning) => void,
): Record<string, unknown> {
  const rewritten = buildLexicalContent(record, resolution, onConversionWarning);
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
  // Phase 21.9 — copy mapped post-meta values onto the document.
  // Only keys with a non-empty WP value land; the override never
  // shadows a field we already populated above (title / slug /
  // content stay protected so a misconfigured override can't
  // overwrite the post body).
  if (fieldOverrides) {
    const protectedFields = new Set([
      "title",
      "slug",
      "content",
      "excerpt",
      "publishedAt",
      "coverImage",
      "categories",
      "tags",
      "author",
    ]);
    for (const [metaKey, fieldName] of Object.entries(fieldOverrides)) {
      if (protectedFields.has(fieldName)) continue;
      const value = record.meta[metaKey];
      if (typeof value === "string" && value.length > 0) {
        data[fieldName] = value;
      }
    }
  }
  // Phase 21.11 — preserve the original WP author byline. Runs after
  // the field-overrides pass so a misconfigured override can't
  // shadow it; runs before the publishedAt write so the timestamp
  // logic stays last.
  if (originalAuthor) {
    data[originalAuthor.field] = originalAuthor.value;
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

function buildLexicalContent(
  record: WpImportRecord,
  resolution: MediaResolution,
  onConversionWarning?: (warning: LexicalConversionWarning) => void,
): LexicalRoot {
  const lexical = htmlToLexical(record.rawContent, { onWarning: onConversionWarning });
  return rewriteLexicalMedia(lexical, resolution);
}

function collectConversionWarning(
  counts: Map<string, number>,
  warning: LexicalConversionWarning,
): void {
  const message =
    warning.code === "unknown-gutenberg-block"
      ? `Unsupported Gutenberg block "${warning.blockName}" was imported by preserving its inner HTML only.`
      : `Gutenberg block "${warning.blockName}" had malformed JSON attributes; inner content was preserved without those attributes.`;
  counts.set(message, (counts.get(message) ?? 0) + 1);
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
 * Phase 21.11 — pick the most readable label for the original WP
 * author. Prefers the channel-level <wp:author_display_name>
 * because that's what ran on the site; falls back to the login
 * (<dc:creator>) when no <wp:author> entry was emitted.
 */
function resolveOriginalAuthorName(
  record: WpImportRecord,
  bundle: WpImportBundle,
): string | undefined {
  const login = record.wpAuthorLogin;
  if (!login) return undefined;
  const match = bundle.authors.find((a) => a.login === login);
  return match?.displayName?.trim() || login;
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

function mapStatusToFramework(status: WpPostStatus): {
  status: "draft" | "published";
  visibility: "public" | "private";
} {
  // Phase 21.17 — `private` posts now round-trip with
  // visibility=private + status=published (anonymous reads
  // auto-filter to visibility=public; authenticated members /
  // staff see both, matching WP's "logged-in users see private
  // posts" rule). "publish" stays public-published; "pending" /
  // "draft" stay as draft with public visibility (drafts aren't
  // shown to anonymous regardless).
  if (status === "publish") return { status: "published", visibility: "public" };
  if (status === "private") return { status: "published", visibility: "private" };
  return { status: "draft", visibility: "public" };
}

function noop(): void {
  /* default log sink */
}

/**
 * Phase 21.10 — fire an audit event when the caller supplied an
 * audit deps object. Audit failures are swallowed: a forensic gap
 * is preferable to aborting an import mid-run with hundreds of
 * already-written rows.
 */
async function emitAudit(deps: AuditDeps | undefined, event: NpWpImportAuditEvent): Promise<void> {
  if (!deps) return;
  try {
    await deps.record(event);
  } catch {
    // Audit insert errors land in the framework's logger via
    // recordAuditEvent's own catch — swallow here so the import
    // doesn't abort.
  }
}
