/**
 * `@nexpress/wp-import` — WordPress migration tooling for NexPress.
 * See `docs/wordpress-import-design.md` for the full design.
 *
 * Phase 21.2 ships only the parser. Subsequent sub-phases bolt on
 * the CLI, content conversion, media pipeline, and DB applier.
 */

export { parseWxr } from "./parse/wxr.js";
export type {
  WpAuthor,
  WpComment,
  WpImportBundle,
  WpImportRecord,
  WpMediaRef,
  WpPostStatus,
  WpSiteInfo,
  WpTerm,
} from "./parse/types.js";
export { runCli, type CliIo, type CliApplyHooks } from "./cli/index.js";
export { formatApplyReport, formatSummary } from "./cli/format.js";
export {
  applyBundle,
  type ApplyOptions,
  type ApplyReport,
  type AppliedRow,
  type CollectionMapping,
  type SkippedRow,
} from "./apply/index.js";
export {
  loadConfigFromPath,
  parseConfig,
  WpImportConfigError,
  type WpImportConfig,
} from "./cli/config.js";
export {
  buildAttachmentIndex,
  type AttachmentEntry,
  type AttachmentIndex,
} from "./apply/attachment-index.js";
export {
  pickPostTermIds,
  resolveTaxonomies,
  termCacheKey,
  type TaxonomyKey,
  type TaxonomyResolution,
  type TaxonomyResolver,
} from "./apply/taxonomies.js";
export {
  emptyCommentPlan,
  importPostComments,
  type CommentDeps,
  type CommentImportPlan,
  type CommentInsertInput,
  type ImportedMemberInput,
} from "./apply/comments.js";
export {
  resolveAuthors,
  type AuthorResolution,
  type AuthorResolveInput,
  type AuthorResolver,
} from "./apply/authors.js";
export { htmlToLexical, type LexicalRoot } from "./convert/html-to-lexical.js";
export {
  downloadMedia,
  isAllowedMimeType,
  WpMediaDownloadError,
  type DownloadOptions,
  type DownloadResult,
} from "./media/download.js";
export {
  runMediaPipeline,
  type MediaPipelineDeps,
  type MediaPipelineError,
  type MediaPipelineOptions,
  type MediaPipelineReport,
  type MediaResolution,
  type MediaUploadInput,
} from "./media/pipeline.js";
export { rewriteLexicalMedia } from "./media/rewrite.js";
