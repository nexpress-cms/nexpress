/**
 * `@nexpress/xliff` — XLIFF 1.2 round-trip for i18n collections.
 *
 * Operators run `exportXliff` to produce per-locale-pair files,
 * hand them to a translation SaaS (Crowdin, Phrase, Smartling,
 * etc.), and apply the returned bundles via `importXliff`.
 *
 * Atomic strings and Lexical `richText` fields round-trip directly. Rich text
 * uses protected XLIFF inline codes so translations replace text leaves without
 * flattening formatting, links, lists, or embedded non-text nodes.
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
