/** Format-neutral translation unit shared by interchange adapters. */
export const NP_TRANSLATION_UNIT_ID_MAX_LENGTH = 4096;

export type NpTranslationInlinePart =
  | { type: "group"; id: string; ctype: string; text: string }
  | { type: "placeholder"; id: string; ctype: string };

export interface NpTranslationUnit {
  id: string;
  /** Plain-text projection for atomic fields and operator summaries. */
  source: string;
  /** Plain-text projection for atomic fields and operator summaries. */
  target: string;
  /** Protected rich-text structure when the unit is not atomic. */
  sourceInline?: NpTranslationInlinePart[];
  /** Protected translated rich-text structure when the unit is not atomic. */
  targetInline?: NpTranslationInlinePart[];
}

export interface NpTranslationDocument {
  /** Opaque live-document route: `{collectionSlug}/{translationGroupId}`. */
  route: string;
  sourceLocale: string;
  targetLocale: string;
  units: NpTranslationUnit[];
}

export interface NpTranslationCatalog {
  documents: NpTranslationDocument[];
}
