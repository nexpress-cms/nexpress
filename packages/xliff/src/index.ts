/**
 * `@nexpress/xliff` — XLIFF 1.2 round-trip for i18n collections.
 *
 * Operators run `exportXliff` to produce per-locale-pair files,
 * hand them to a translation SaaS (Crowdin, Phrase, Smartling,
 * etc.), and apply the returned bundles via `importXliff`.
 *
 * Atomic strings, Lexical `richText`, and schema-declared block props
 * round-trip directly. Protected ids and inline codes let translations replace
 * visitor-facing text without flattening formatting or guessing block paths.
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
  type XliffInlinePart,
} from "./format.js";

export { runCli, type CliIo, type CliRunResult } from "./cli.js";
