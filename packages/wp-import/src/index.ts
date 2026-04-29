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
export { runCli, type CliIo } from "./cli/index.js";
export { formatSummary } from "./cli/format.js";
