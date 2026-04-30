/**
 * `@nexpress/xliff` — XLIFF 1.2 round-trip for i18n collections.
 *
 * Operators run `exportXliff` to produce per-locale-pair files,
 * hand them to a translation SaaS (Crowdin, Phrase, Smartling,
 * etc.), and apply the returned bundles via `importXliff`.
 *
 * v1 covers atomic-string fields only (`text`, `textarea`,
 * `email`). Rich-text and structured fields stay out of scope —
 * those still go through the admin TranslationTabs flow.
 */

export {
  exportXliff,
  XliffExportError,
  type XliffExportOptions,
  type XliffExportFile,
  type XliffExportBundle,
} from "./export.js";

export {
  importXliff,
  XliffImportError,
  type XliffImportOptions,
  type XliffImportApplied,
  type XliffImportSkip,
  type XliffImportResult,
} from "./import.js";

export {
  parseXliff,
  renderXliff,
  XliffParseError,
  type XliffDocument,
  type XliffFile,
  type XliffTransUnit,
} from "./format.js";

export { runCli, type CliIo, type CliRunResult } from "./cli.js";
