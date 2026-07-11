/** `@nexpress/gettext` — Gettext PO round-trip for i18n collections. */

export {
  exportGettext,
  GettextExportError,
  type GettextExportOptions,
  type GettextExportFile,
  type GettextExportBundle,
} from "./export.js";

export {
  importGettext,
  GettextImportError,
  type GettextImportOptions,
  type GettextImportApplied,
  type GettextImportSkip,
  type GettextImportResult,
} from "./import.js";

export { parseGettext, renderGettext, GettextParseError, GettextRenderError } from "./format.js";

export { runCli, type CliIo, type CliRunResult } from "./cli.js";
