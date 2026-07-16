import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { NpNotFoundError, NpValidationError } from "../errors.js";
import { getI18nConfig } from "../i18n/registry.js";
import { npRequireTranslationProgressResponse } from "../i18n-contract/contract.js";
import type {
  NpCollectionTranslationProgress,
  NpTranslationProgress,
  NpTranslationProgressLocaleStats,
} from "../i18n-contract/types.js";
import type { NpAuthUser } from "../config/types.js";

export type {
  NpCollectionTranslationProgress,
  NpTranslationProgress,
  NpTranslationProgressLocaleStats,
} from "../i18n-contract/types.js";

import { getAllCollectionSlugs, getCollectionConfig, getCollectionTable } from "./registry.js";
import { getDocumentById, saveDocument } from "./pipeline.js";
import { getDb } from "../db/runtime.js";
import { npCollectionDocumentToWriteInput } from "../collection-contract/contract.js";

interface TranslationRow {
  id: string;
  locale: string;
  slug: string;
  status: string;
  title?: unknown;
  updatedAt?: Date | string | null;
  translationGroupId: string;
}

function getTableColumn(table: PgTable, name: string): unknown {
  const column = (table as unknown as Record<string, unknown>)[name];
  if (!column) {
    throw new Error(`Column "${name}" not found on table`);
  }
  return column;
}

/**
 * Phase 12.3 — list every locale variant linked to the given
 * document. The `translationGroupId` keys the sibling lookup;
 * the originating row is included so callers can render a
 * "current row + others" tab strip without a separate query.
 *
 * Returns rows in the locale order from `getI18nConfig()` so
 * the UI's tab order matches the configured locale list rather
 * than insertion order.
 */
export async function findTranslations(
  collection: string,
  docId: string,
): Promise<TranslationRow[]> {
  const config = getCollectionConfig(collection);
  if (!config.i18n) {
    throw new NpValidationError("Invalid input", [
      {
        field: "collection",
        message: `Collection "${collection}" is not i18n-enabled`,
      },
    ]);
  }
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb();
  const source = await getDocumentById(collection, docId);
  if (!source) throw new NpNotFoundError(collection, docId);
  const groupId = (source as { translationGroupId?: string }).translationGroupId;
  if (!groupId) {
    throw new Error(`Doc ${docId} in collection "${collection}" has no translationGroupId`);
  }

  const rows = (await db
    .select()
    .from(table)
    .where(eq(getTableColumn(table, "translationGroupId") as never, groupId))) as Array<
    Record<string, unknown>
  >;

  const ordering = getI18nConfig()?.locales ?? [];
  const rank = (locale: string): number => {
    const i = ordering.indexOf(locale);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  return rows
    .map((r): TranslationRow => ({
      id: String(r.id),
      locale: String(r.locale),
      slug: String(r.slug),
      status: String(r.status),
      title: r.title,
      updatedAt: r.updatedAt as Date | string | null,
      translationGroupId: String(r.translationGroupId),
    }))
    .sort((a, b) => rank(a.locale) - rank(b.locale));
}

/**
 * Phase 12.3 — copy a doc into a new locale. The source row's
 * data is reused minus `id` / `slug` / `locale` / status; the
 * new row gets the source's `translationGroupId` so the two
 * link as siblings. The pipeline's locale validation runs as
 * usual (rejects unknown locales).
 *
 * The copy lands as a draft (`status: "draft"`) — translators
 * almost always want to review before publishing. Promote
 * normally via the existing publish flow once the translation
 * is ready.
 *
 * Slug is intentionally NOT copied: `applySlugField` will
 * derive a fresh one from the title (or whatever the configured
 * `useField` is) so the (locale, slug) unique index doesn't
 * collide if the source already used the slug in that locale.
 * Callers can override post-create via the regular update path.
 */
export async function createTranslation(
  collection: string,
  sourceDocId: string,
  targetLocale: string,
  user: NpAuthUser,
): Promise<{ id: string }> {
  const config = getCollectionConfig(collection);
  if (!config.i18n) {
    throw new NpValidationError("Invalid input", [
      {
        field: "collection",
        message: `Collection "${collection}" is not i18n-enabled`,
      },
    ]);
  }
  const i18n = getI18nConfig();
  if (!i18n) {
    throw new Error("i18n config is not initialised");
  }
  if (!i18n.locales.includes(targetLocale)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "targetLocale",
        message: `Locale "${targetLocale}" is not configured`,
      },
    ]);
  }

  const source = await getDocumentById(collection, sourceDocId);
  if (!source) throw new NpNotFoundError(collection, sourceDocId);

  const sourceLocale = (source as { locale?: string }).locale;
  if (sourceLocale === targetLocale) {
    throw new NpValidationError("Invalid input", [
      {
        field: "targetLocale",
        message: `Source row is already in locale "${targetLocale}"`,
      },
    ]);
  }

  // Reject duplicate translations — the (translationGroupId,
  // locale) shouldn't repeat. A second `createTranslation`
  // call for the same target should noop or 409 rather than
  // accidentally creating two rows the unique index would
  // happily accept (since slug differs).
  const existing = await findTranslations(collection, sourceDocId);
  if (existing.some((r) => r.locale === targetLocale)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "targetLocale",
        message: `A "${targetLocale}" translation already exists for this document`,
      },
    ]);
  }

  const groupId = (source as { translationGroupId?: string }).translationGroupId;
  if (!groupId) {
    throw new Error(`Doc ${sourceDocId} in collection "${collection}" has no translationGroupId`);
  }

  // Strip framework-managed columns; saveDocument re-derives
  // them. Preserves user-authored fields (title / body / blocks
  // / etc.) so the translator has a starting point rather than
  // a blank form.
  const content = npCollectionDocumentToWriteInput(source, config);
  delete content.slug;

  const result = await saveDocument(
    collection,
    null,
    {
      ...content,
      locale: targetLocale,
      translationGroupId: groupId,
    },
    user,
    { status: "draft" },
  );

  return { id: result.doc.id as string };
}

/**
 * Phase 12.6 — translation completeness snapshot for the
 * admin Locales tab.
 *
 * Walks every i18n-enabled collection and counts:
 *   - `totalGroups` — distinct `translation_group_id` values
 *     (one per "logical document"; if the source has 5 base
 *     pages, that's 5 groups regardless of locale spread)
 *   - `counts[locale]` — actual rows per locale
 *   - `missing[locale]` — `totalGroups - counts[locale]`,
 *     i.e. how many groups still need this locale
 *
 * Returns `null` when i18n isn't configured. Non-i18n
 * collections are silently skipped — they don't have the
 * `translation_group_id` column and the dashboard isn't
 * meaningful for them.
 *
 * One SQL round-trip per i18n collection (two GROUP BYs in a
 * single query). For 1–2 i18n collections this is well under
 * the cost of the existing dashboard widgets.
 */
export async function getTranslationProgress(): Promise<NpTranslationProgress | null> {
  const i18n = getI18nConfig();
  if (!i18n) return null;

  const db = getDb();
  const out: NpCollectionTranslationProgress[] = [];

  for (const slug of getAllCollectionSlugs()) {
    const config = getCollectionConfig(slug);
    if (!config.i18n) continue;
    const table = getCollectionTable(slug) as PgTable;
    const localeCol = getTableColumn(table, "locale");
    const groupCol = getTableColumn(table, "translationGroupId");

    // Two parallel queries: per-locale row counts, plus the
    // total group count. Could be fused into one CTE, but the
    // two-query form keeps the Drizzle expressions readable
    // and the cost is negligible for the volumes the admin UI
    // is reading.
    const localeRows = (await db
      .select({
        locale: localeCol as never,
        count: sql<number>`count(*)::int`,
      })
      .from(table)
      .groupBy(localeCol as never)) as Array<{
      locale: string;
      count: number;
    }>;

    const totalRows = (await db
      .select({
        groups: sql<number>`count(distinct ${groupCol})::int`,
      })
      .from(table)) as Array<{ groups: number }>;

    const totalGroups = totalRows[0]?.groups ?? 0;

    const counts: Record<string, number> = Object.fromEntries(i18n.locales.map((loc) => [loc, 0]));
    for (const row of localeRows) {
      if (row.locale in counts) {
        counts[row.locale] = row.count;
      }
    }

    const perLocale: Record<string, NpTranslationProgressLocaleStats> = {};
    for (const loc of i18n.locales) {
      const count = counts[loc] ?? 0;
      perLocale[loc] = {
        count,
        missing: Math.max(0, totalGroups - count),
      };
    }

    out.push({
      collection: slug,
      totalGroups,
      perLocale,
    });
  }

  return npRequireTranslationProgressResponse({
    defaultLocale: i18n.defaultLocale,
    locales: i18n.locales,
    collections: out,
  });
}
