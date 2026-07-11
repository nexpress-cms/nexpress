import {
  extractTranslationCatalogs,
  NpTranslationExtractError,
  type NpTranslationExtractOptions,
} from "@nexpress/translation";

import { renderGettext } from "./format.js";

export type GettextExportOptions = NpTranslationExtractOptions;

export interface GettextExportFile {
  /** Suggested filename, e.g. `discussions-en-ko.po`. */
  name: string;
  collection: string;
  sourceLocale: string;
  targetLocale: string;
  unitCount: number;
  po: string;
}

export interface GettextExportBundle {
  files: GettextExportFile[];
  summary: {
    docCount: number;
    fieldCount: number;
    sourceLocale: string;
    targetLocales: string[];
  };
}

/** Extract live translation catalogs and serialize each locale pair as PO. */
export async function exportGettext(
  options: GettextExportOptions = {},
): Promise<GettextExportBundle> {
  try {
    const extracted = await extractTranslationCatalogs(options);
    return {
      files: extracted.catalogs.map((item) => ({
        name: `${item.name}.po`,
        collection: item.collection,
        sourceLocale: item.sourceLocale,
        targetLocale: item.targetLocale,
        unitCount: item.unitCount,
        po: renderGettext(item.catalog),
      })),
      summary: extracted.summary,
    };
  } catch (error) {
    if (error instanceof NpTranslationExtractError) {
      throw new GettextExportError(error.message);
    }
    throw error;
  }
}

export class GettextExportError extends Error {
  override readonly name = "GettextExportError";
}
