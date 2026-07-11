import {
  extractTranslationCatalogs,
  NpTranslationExtractError,
  type NpTranslationExtractOptions,
} from "@nexpress/translation";

import { renderXliff, type XliffDocument, type XliffFile } from "./format.js";

export type XliffExportOptions = NpTranslationExtractOptions;

export interface XliffExportFile {
  /** Suggested filename, e.g. `discussions-en-ko.xliff`. */
  name: string;
  collection: string;
  sourceLocale: string;
  targetLocale: string;
  unitCount: number;
  xml: string;
}

export interface XliffExportBundle {
  files: XliffExportFile[];
  summary: {
    docCount: number;
    fieldCount: number;
    sourceLocale: string;
    targetLocales: string[];
  };
}

/** Serialize shared translation catalogs as XLIFF 1.2. */
export async function exportXliff(options: XliffExportOptions = {}): Promise<XliffExportBundle> {
  try {
    const extracted = await extractTranslationCatalogs(options);
    return {
      files: extracted.catalogs.map((item) => ({
        name: `${item.name}.xliff`,
        collection: item.collection,
        sourceLocale: item.sourceLocale,
        targetLocale: item.targetLocale,
        unitCount: item.unitCount,
        xml: renderXliff(toXliffDocument(item.catalog)),
      })),
      summary: extracted.summary,
    };
  } catch (error) {
    if (error instanceof NpTranslationExtractError) {
      throw new XliffExportError(error.message);
    }
    throw error;
  }
}

export class XliffExportError extends Error {
  override readonly name = "XliffExportError";
}

function toXliffDocument(catalog: {
  documents: Array<{
    route: string;
    sourceLocale: string;
    targetLocale: string;
    units: XliffFile["units"];
  }>;
}): XliffDocument {
  return {
    files: catalog.documents.map((document) => ({
      original: document.route,
      sourceLocale: document.sourceLocale,
      targetLocale: document.targetLocale,
      units: document.units,
    })),
  };
}
