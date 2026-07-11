import {
  findDocuments,
  getAllCollectionSlugs,
  getCollectionConfig,
  getI18nConfig,
  type NpAuthUser,
} from "@nexpress/core";

import { renderXliff, type XliffFile, type XliffTransUnit } from "./format.js";
import { createRichTextXliffValue } from "./rich-text.js";

export interface XliffExportOptions {
  /**
   * Restrict to specific collection slugs. Defaults to every
   * registered i18n-enabled collection. Non-i18n collections are
   * always skipped — they have no `locale` / `translation_group_id`
   * to round-trip.
   */
  collections?: string[];
  /**
   * Locale to treat as the source. Defaults to the configured
   * `defaultLocale`. Translators don't usually translate from a
   * non-default locale, but the option is here for sites that
   * author primarily in another language.
   */
  sourceLocale?: string;
  /**
   * Target locales to emit a file for. Defaults to every
   * configured locale except the source.
   */
  targetLocales?: string[];
  /**
   * Operator running the export. Threaded into `findDocuments` so
   * private-visibility rows still surface to a translator's bundle
   * (#383). Without it, the pipeline's anonymous-visibility guard
   * silently filters every `visibility = "private"` document out
   * of both the source scan and the existing-target scan, so
   * private docs can't round-trip through XLIFF at all.
   */
  user?: NpAuthUser;
}

export interface XliffExportFile {
  /** Suggested filename, e.g. `discussions-en-ko.xliff`. */
  name: string;
  collection: string;
  sourceLocale: string;
  targetLocale: string;
  /** Number of (doc × translatable field) units in this file. */
  unitCount: number;
  xml: string;
}

export interface XliffExportBundle {
  files: XliffExportFile[];
  summary: {
    /** Number of source-locale documents seen across all files. */
    docCount: number;
    /** Sum of `unitCount` across `files`. */
    fieldCount: number;
    sourceLocale: string;
    targetLocales: string[];
  };
}

/**
 * Atomic strings and Lexical rich text round-trip through XLIFF. Blocks and
 * other structured types remain outside this contract until their schemas can
 * declare exactly which nested values are translatable.
 */
const TRANSLATABLE_TYPES = new Set(["text", "textarea", "email", "richText"]);

type TranslatableField = {
  name: string;
  type: "text" | "textarea" | "email" | "richText";
};

/**
 * Walk every i18n-enabled collection (or the subset the caller
 * named), pull every published source-locale row, and emit one
 * XLIFF 1.2 file per (collection, target locale). Each file's
 * `<file original=…>` attribute encodes routing back as
 * `{collectionSlug}/{translationGroupId}` so the import path can
 * resolve siblings without rescanning the registry.
 *
 * Pre-existing target translations (sibling rows already in the
 * target locale) are loaded so their values populate `<target>`
 * — this lets translators see what's already done and edit
 * incrementally rather than re-translating from scratch on each
 * round-trip.
 */
export async function exportXliff(options: XliffExportOptions = {}): Promise<XliffExportBundle> {
  const i18n = getI18nConfig();
  if (!i18n) {
    throw new XliffExportError(
      "i18n is not configured — call setI18nConfig() before exporting XLIFF",
    );
  }

  const sourceLocale = options.sourceLocale ?? i18n.defaultLocale;
  if (!i18n.locales.includes(sourceLocale)) {
    throw new XliffExportError(
      `sourceLocale "${sourceLocale}" is not in the configured locale list`,
    );
  }

  const targetLocales = (
    options.targetLocales ?? i18n.locales.filter((l) => l !== sourceLocale)
  ).filter((l) => l !== sourceLocale);
  for (const t of targetLocales) {
    if (!i18n.locales.includes(t)) {
      throw new XliffExportError(`targetLocale "${t}" is not in the configured locale list`);
    }
  }

  const slugs = options.collections ?? getAllCollectionSlugs();

  const files: XliffExportFile[] = [];
  let totalDocCount = 0;
  let totalFieldCount = 0;

  for (const slug of slugs) {
    let config;
    try {
      config = getCollectionConfig(slug);
    } catch {
      continue;
    }
    if (!config.i18n) continue;

    const translatableFields = config.fields
      .filter((f) => "name" in f && TRANSLATABLE_TYPES.has(f.type))
      .map(
        (f) =>
          ({
            name: (f as { name: string }).name,
            type: f.type,
          }) as TranslatableField,
      );
    if (translatableFields.length === 0) continue;

    // Source-locale rows. We scan published only — drafts are
    // mid-edit and shouldn't ship to a translator. The actor is
    // threaded so private-visibility rows still surface (#383)
    // — without a user, the pipeline restricts to public.
    const sourceResult = await findDocuments(
      slug,
      {
        limit: 5000,
        page: 1,
        where: { status: "published" },
        locale: sourceLocale,
      },
      options.user,
    );
    const sourceDocs = sourceResult.docs;
    if (sourceDocs.length === 0) continue;
    totalDocCount += sourceDocs.length;

    for (const targetLocale of targetLocales) {
      // Load every existing target sibling so the export can
      // pre-fill `<target>` with whatever's already translated
      // (preserves work-in-progress on round-trips). DRAFT
      // siblings count too — they're typically the in-progress
      // translation a reviewer hasn't promoted yet, and excluding
      // them would zero out the `<target>` and force the
      // translator to redo the work.
      const targetResult = await findDocuments(
        slug,
        {
          limit: 5000,
          page: 1,
          locale: targetLocale,
        },
        options.user,
      );
      const targetByGroupId = new Map<string, Record<string, unknown>>();
      for (const doc of targetResult.docs) {
        const groupId = (doc as { translationGroupId?: string }).translationGroupId;
        if (groupId) targetByGroupId.set(groupId, doc);
      }

      const fileUnits: XliffTransUnit[] = [];
      const filesByGroup: XliffFile[] = [];

      for (const sourceDoc of sourceDocs) {
        const groupId = (sourceDoc as { translationGroupId?: string }).translationGroupId;
        if (!groupId) continue;
        const targetDoc = targetByGroupId.get(groupId) ?? null;

        const docUnits: XliffTransUnit[] = [];
        for (const field of translatableFields) {
          if (field.type === "richText") {
            const richText = createRichTextXliffValue(
              sourceDoc[field.name],
              targetDoc?.[field.name],
            );
            if (!richText) continue;
            docUnits.push({
              id: field.name,
              source: richText.source,
              target: richText.target,
              sourceInline: richText.sourceInline,
              targetInline: richText.targetInline,
            });
            continue;
          }

          const sourceValue = stringField(sourceDoc, field.name);
          // Skip empty source — nothing to translate. (An
          // operator can re-export after filling the source.)
          if (sourceValue === "") continue;
          const targetValue = targetDoc ? stringField(targetDoc, field.name) : "";
          docUnits.push({
            id: field.name,
            source: sourceValue,
            target: targetValue,
          });
        }
        if (docUnits.length === 0) continue;

        filesByGroup.push({
          original: `${slug}/${groupId}`,
          sourceLocale,
          targetLocale,
          units: docUnits,
        });
        fileUnits.push(...docUnits);
      }

      if (filesByGroup.length === 0) continue;

      const xml = renderXliff({ files: filesByGroup });
      files.push({
        name: `${slug}-${sourceLocale}-${targetLocale}.xliff`,
        collection: slug,
        sourceLocale,
        targetLocale,
        unitCount: fileUnits.length,
        xml,
      });
      totalFieldCount += fileUnits.length;
    }
  }

  return {
    files,
    summary: {
      docCount: totalDocCount,
      fieldCount: totalFieldCount,
      sourceLocale,
      targetLocales,
    },
  };
}

export class XliffExportError extends Error {
  override readonly name = "XliffExportError";
}

function stringField(doc: Record<string, unknown>, fieldName: string): string {
  const v = doc[fieldName];
  return typeof v === "string" ? v : "";
}
