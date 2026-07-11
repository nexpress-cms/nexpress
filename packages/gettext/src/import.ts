import { type NpAuthUser } from "@nexpress/core";
import {
  applyTranslationCatalog,
  NpTranslationApplyError,
  type NpTranslationApplied,
  type NpTranslationApplyResult,
  type NpTranslationSkip,
} from "@nexpress/translation";

import { parseGettext } from "./format.js";

export interface GettextImportOptions {
  po: string | Buffer;
  user: NpAuthUser;
  dryRun?: boolean;
}

export type GettextImportApplied = NpTranslationApplied;
export type GettextImportSkip = NpTranslationSkip;
export type GettextImportResult = NpTranslationApplyResult;

/** Parse PO, then delegate all live-document validation and writes. */
export async function importGettext(options: GettextImportOptions): Promise<GettextImportResult> {
  const catalog = parseGettext(options.po);
  try {
    return await applyTranslationCatalog({
      catalog,
      user: options.user,
      dryRun: options.dryRun,
    });
  } catch (error) {
    if (error instanceof NpTranslationApplyError) {
      throw new GettextImportError(error.message);
    }
    throw error;
  }
}

export class GettextImportError extends Error {
  override readonly name = "GettextImportError";
}
