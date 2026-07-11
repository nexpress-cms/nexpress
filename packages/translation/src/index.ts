/**
 * Format-neutral content translation extraction and application contracts.
 *
 * Interchange adapters serialize `NpTranslationCatalog`; this package alone
 * owns collection lookup, sibling routing, and fail-closed field application.
 */

export {
  extractTranslationCatalogs,
  NpTranslationExtractError,
  type NpTranslationExtractOptions,
  type NpExtractedTranslationCatalog,
  type NpTranslationExtraction,
} from "./extract.js";

export {
  applyTranslationCatalog,
  NpTranslationApplyError,
  type NpTranslationApplyOptions,
  type NpTranslationApplied,
  type NpTranslationSkip,
  type NpTranslationApplyResult,
} from "./apply.js";

export {
  NP_TRANSLATION_UNIT_ID_MAX_LENGTH,
  type NpTranslationCatalog,
  type NpTranslationDocument,
  type NpTranslationInlinePart,
  type NpTranslationUnit,
} from "./types.js";
