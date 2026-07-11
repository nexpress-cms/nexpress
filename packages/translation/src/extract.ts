import {
  findDocuments,
  getAllCollectionSlugs,
  getCollectionConfig,
  getI18nConfig,
  type NpAuthUser,
} from "@nexpress/core";

import { createBlockTranslationUnits } from "./blocks.js";
import { createRichTextTranslationValue } from "./rich-text.js";
import {
  type NpTranslationCatalog,
  type NpTranslationDocument,
  type NpTranslationUnit,
} from "./types.js";

export interface NpTranslationExtractOptions {
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
   * private docs cannot enter any translation catalog at all.
   */
  user?: NpAuthUser;
}

export interface NpExtractedTranslationCatalog {
  /** Suggested extension-free name, e.g. `discussions-en-ko`. */
  name: string;
  collection: string;
  sourceLocale: string;
  targetLocale: string;
  /** Number of translation units in this catalog. */
  unitCount: number;
  catalog: NpTranslationCatalog;
}

export interface NpTranslationExtraction {
  catalogs: NpExtractedTranslationCatalog[];
  summary: {
    /** Number of source-locale documents seen across all catalogs. */
    docCount: number;
    /** Sum of `unitCount` across `catalogs`. */
    fieldCount: number;
    sourceLocale: string;
    targetLocales: string[];
  };
}

/**
 * Atomic strings, Lexical rich text, and block props explicitly declared
 * translatable in their registered schema enter interchange catalogs. Other
 * structured types remain outside this contract.
 */
const TRANSLATABLE_TYPES = new Set(["text", "textarea", "email", "richText", "blocks"]);

type TranslatableField = {
  name: string;
  type: "text" | "textarea" | "email" | "richText" | "blocks";
};

/**
 * Walk every i18n-enabled collection (or the subset the caller
 * named), pull every published source-locale row, and emit one catalog per
 * (collection, target locale). Each document carries an opaque
 * `{collectionSlug}/{translationGroupId}` route so adapters can serialize it
 * without owning database lookup rules.
 *
 * Pre-existing target translations (sibling rows already in the
 * target locale) are loaded so their values populate target text
 * — this lets translators see what's already done and edit
 * incrementally rather than re-translating from scratch on each
 * round-trip.
 */
export async function extractTranslationCatalogs(
  options: NpTranslationExtractOptions = {},
): Promise<NpTranslationExtraction> {
  const i18n = getI18nConfig();
  if (!i18n) {
    throw new NpTranslationExtractError(
      "i18n is not configured — call setI18nConfig() before extracting translations",
    );
  }

  const sourceLocale = options.sourceLocale ?? i18n.defaultLocale;
  if (!i18n.locales.includes(sourceLocale)) {
    throw new NpTranslationExtractError(
      `sourceLocale "${sourceLocale}" is not in the configured locale list`,
    );
  }

  const targetLocales = (
    options.targetLocales ?? i18n.locales.filter((l) => l !== sourceLocale)
  ).filter((l) => l !== sourceLocale);
  for (const t of targetLocales) {
    if (!i18n.locales.includes(t)) {
      throw new NpTranslationExtractError(
        `targetLocale "${t}" is not in the configured locale list`,
      );
    }
  }

  const slugs = options.collections ?? getAllCollectionSlugs();

  const catalogs: NpExtractedTranslationCatalog[] = [];
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
      // pre-fill target text with whatever is already translated
      // (preserves work-in-progress on round-trips). DRAFT
      // siblings count too — they're typically the in-progress
      // translation a reviewer hasn't promoted yet, and excluding
      // them would zero out the target and force the
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

      const catalogUnits: NpTranslationUnit[] = [];
      const documents: NpTranslationDocument[] = [];

      for (const sourceDoc of sourceDocs) {
        const groupId = (sourceDoc as { translationGroupId?: string }).translationGroupId;
        if (!groupId) continue;
        const targetDoc = targetByGroupId.get(groupId) ?? null;

        const docUnits: NpTranslationUnit[] = [];
        for (const field of translatableFields) {
          if (field.type === "blocks") {
            docUnits.push(
              ...createBlockTranslationUnits(
                field.name,
                sourceDoc[field.name],
                targetDoc?.[field.name],
              ),
            );
            continue;
          }
          if (field.type === "richText") {
            const richText = createRichTextTranslationValue(
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

        documents.push({
          route: `${slug}/${groupId}`,
          sourceLocale,
          targetLocale,
          units: docUnits,
        });
        catalogUnits.push(...docUnits);
      }

      if (documents.length === 0) continue;

      catalogs.push({
        name: `${slug}-${sourceLocale}-${targetLocale}`,
        collection: slug,
        sourceLocale,
        targetLocale,
        unitCount: catalogUnits.length,
        catalog: { documents },
      });
      totalFieldCount += catalogUnits.length;
    }
  }

  return {
    catalogs,
    summary: {
      docCount: totalDocCount,
      fieldCount: totalFieldCount,
      sourceLocale,
      targetLocales,
    },
  };
}

export class NpTranslationExtractError extends Error {
  override readonly name = "NpTranslationExtractError";
}

function stringField(doc: Record<string, unknown>, fieldName: string): string {
  const v = doc[fieldName];
  return typeof v === "string" ? v : "";
}
