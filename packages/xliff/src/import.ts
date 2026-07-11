import {
  applyTranslationCatalog,
  NpTranslationApplyError,
  type NpTranslationApplied,
  type NpTranslationApplyResult,
  type NpTranslationSkip,
} from "@nexpress/translation";
import { type NpAuthUser } from "@nexpress/core";

import { parseXliff } from "./format.js";

export interface XliffImportOptions {
  xml: string;
  user: NpAuthUser;
  dryRun?: boolean;
}

export type XliffImportApplied = NpTranslationApplied;
export type XliffImportSkip = NpTranslationSkip;
export type XliffImportResult = NpTranslationApplyResult;

/** Parse XLIFF, then delegate all live-document validation and writes. */
export async function importXliff(options: XliffImportOptions): Promise<XliffImportResult> {
  const parsed = parseXliff(options.xml);
  try {
    return await applyTranslationCatalog({
      catalog: {
        documents: parsed.files.map((file) => ({
          route: file.original,
          sourceLocale: file.sourceLocale,
          targetLocale: file.targetLocale,
          units: file.units,
        })),
      },
      user: options.user,
      dryRun: options.dryRun,
    });
  } catch (error) {
    if (error instanceof NpTranslationApplyError) {
      throw new XliffImportError(error.message);
    }
    throw error;
  }
}

export class XliffImportError extends Error {
  override readonly name = "XliffImportError";
}
