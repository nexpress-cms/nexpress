import {
  findDocuments,
  getCollectionConfig,
  getDocumentById,
  getI18nConfig,
  npCollectionDocumentToWriteInput,
  saveDocument,
  type NpAuthUser,
} from "@nexpress/core";

import {
  applyBlockTranslationUnit,
  createBlockImportBaseline,
  parseBlockUnitId,
} from "./blocks.js";
import { applyRichTextTranslationValue } from "./rich-text.js";
import { type NpTranslationCatalog } from "./types.js";

/**
 * Field types whose values round-trip through interchange catalogs. Rich text has a
 * stricter inline-code contract; block fields accept only registered schema
 * paths explicitly declared translatable. Other structured values remain
 * rejected.
 */
const TRANSLATABLE_TYPES = new Set(["text", "textarea", "email", "richText", "blocks"]);

type TranslatableFieldType = "text" | "textarea" | "email" | "richText";

export interface NpTranslationApplyOptions {
  /** Parsed format-neutral catalog to validate and apply. */
  catalog: NpTranslationCatalog;
  /** Actor recorded on writes (createdBy / updatedBy / audit). */
  user: NpAuthUser;
  /**
   * When true, parses + resolves siblings + reports what would
   * happen, but writes nothing. Useful for previewing a
   * translator's bundle before applying.
   */
  dryRun?: boolean;
}

export interface NpTranslationApplied {
  collection: string;
  /** Document id that was created or updated. */
  docId: string;
  locale: string;
  operation: "create" | "update";
  /** Number of translation units actually written for this doc. */
  unitCount: number;
}

export interface NpTranslationSkip {
  reason: string;
  collection?: string;
  groupId?: string;
  locale?: string;
}

export interface NpTranslationApplyResult {
  applied: NpTranslationApplied[];
  skipped: NpTranslationSkip[];
  /**
   * Whether this run actually touched the database. False when
   * `dryRun: true` or when every document matched a `skipped` rule.
   */
  wrote: boolean;
}

/**
 * Apply a parsed translation catalog. For each routed document:
 *
 *   1. Parse `route` as `{collectionSlug}/{translationGroupId}`.
 *   2. Look up the source-locale sibling (used as the canonical
 *      shape when creating a new target row — non-translatable
 *      fields are copied across).
 *   3. Look up the target-locale sibling. If found, UPDATE its
 *      translatable fields with each unit's target. If not,
 *      CREATE a new sibling using the source data + target
 *      values for translatable fields.
 *
 * Empty target text is skipped — a translator who hasn't yet
 * translated that unit shouldn't blank out an existing target.
 * If every unit in a document has an empty target, the document is
 * recorded as skipped rather than landing an empty draft.
 *
 * Errors per document are isolated: a malformed route or a
 * missing source sibling adds a `skipped` entry but the rest of
 * the bundle still applies. Throwing is reserved for global
 * problems such as missing i18n configuration.
 */
export async function applyTranslationCatalog(
  options: NpTranslationApplyOptions,
): Promise<NpTranslationApplyResult> {
  const i18n = getI18nConfig();
  if (!i18n) {
    throw new NpTranslationApplyError(
      "i18n is not configured — call setI18nConfig() before applying translations",
    );
  }

  const applied: NpTranslationApplied[] = [];
  const skipped: NpTranslationSkip[] = [];
  const documentKeyCounts = countValues(
    options.catalog.documents.map((document) =>
      JSON.stringify([document.route, document.sourceLocale, document.targetLocale]),
    ),
  );
  const reportedDuplicateDocuments = new Set<string>();

  for (const document of options.catalog.documents) {
    const documentKey = JSON.stringify([
      document.route,
      document.sourceLocale,
      document.targetLocale,
    ]);
    if ((documentKeyCounts.get(documentKey) ?? 0) > 1) {
      if (!reportedDuplicateDocuments.has(documentKey)) {
        skipped.push({
          reason: `Ignored duplicate translation document route "${document.route}" for locale "${document.targetLocale}"`,
          locale: document.targetLocale,
        });
        reportedDuplicateDocuments.add(documentKey);
      }
      continue;
    }
    const parsed = parseDocumentRoute(document.route);
    if (!parsed) {
      skipped.push({
        reason: `Malformed document route "${document.route}" (expected "{collection}/{groupId}")`,
      });
      continue;
    }
    const { collection, groupId } = parsed;

    if (!i18n.locales.includes(document.sourceLocale)) {
      skipped.push({
        reason: `Source locale "${document.sourceLocale}" is not configured`,
        collection,
        groupId,
        locale: document.targetLocale,
      });
      continue;
    }
    if (!i18n.locales.includes(document.targetLocale)) {
      skipped.push({
        reason: `Target locale "${document.targetLocale}" is not configured`,
        collection,
        groupId,
        locale: document.targetLocale,
      });
      continue;
    }
    if (document.sourceLocale === document.targetLocale) {
      skipped.push({
        reason: "Source and target locales must differ",
        collection,
        groupId,
        locale: document.targetLocale,
      });
      continue;
    }

    let config;
    try {
      config = getCollectionConfig(collection);
    } catch {
      skipped.push({
        reason: `Unknown collection "${collection}"`,
        collection,
        groupId,
        locale: document.targetLocale,
      });
      continue;
    }
    if (!config.i18n) {
      skipped.push({
        reason: `Collection "${collection}" is not i18n-enabled`,
        collection,
        groupId,
        locale: document.targetLocale,
      });
      continue;
    }

    // Whitelist of translation unit ids the importer will honor —
    // matches the export side's translatable-types contract.
    // Anything else is rejected with
    // a `skipped` entry rather than silently spread onto the
    // row: a malicious or hand-edited catalog that ships `locale`
    // could otherwise mutate the
    // sibling's locale or `translation_group_id` (i18n columns
    // pass through Zod by design) and corrupt the
    // (locale, translationGroupId) sibling structure.
    const translatableFields = new Map<string, TranslatableFieldType>(
      config.fields
        .filter((f) => "name" in f && f.type !== "blocks" && TRANSLATABLE_TYPES.has(f.type))
        .map((f) => [(f as { name: string }).name, f.type as TranslatableFieldType]),
    );
    const blockFields = new Set(
      config.fields
        .filter((field) => "name" in field && field.type === "blocks")
        .map((field) => (field as { name: string }).name),
    );

    // Resolve the source sibling — needed both for the create
    // path (template for non-translatable fields) and as a
    // sanity check (no source means the file is stale or the
    // doc was deleted). The operator is threaded so private
    // sibling rows still surface (#383) — without a user, the
    // pipeline's anonymous-visibility guard restricts to public
    // and a private translation target is invisible, which
    // would either skip the row or trigger a duplicate-create.
    const sourceSibling = await findSibling(
      collection,
      groupId,
      document.sourceLocale,
      options.user,
    );
    if (!sourceSibling) {
      skipped.push({
        reason: `No source row for groupId=${groupId} locale=${document.sourceLocale}`,
        collection,
        groupId,
        locale: document.targetLocale,
      });
      continue;
    }

    const targetSibling = await findSibling(
      collection,
      groupId,
      document.targetLocale,
      options.user,
    );

    // Build field overrides from non-empty targets whose ids match a
    // translatable field. Rich-text units are additionally checked against the
    // live source Lexical structure before any target fragments are applied.
    const overrides: Record<string, unknown> = {};
    const blockValues = new Map<string, unknown>();
    const rejectedFieldIds: string[] = [];
    const unitIdCounts = countValues(document.units.map((unit) => unit.id));
    const reportedDuplicateUnitIds = new Set<string>();
    const documentSkipCount = skipped.length;
    let appliedUnitCount = 0;
    for (const unit of document.units) {
      if ((unitIdCounts.get(unit.id) ?? 0) > 1) {
        if (!reportedDuplicateUnitIds.has(unit.id)) {
          skipped.push({
            reason: `Ignored duplicate translation unit id "${unit.id}"`,
            collection,
            groupId,
            locale: document.targetLocale,
          });
          reportedDuplicateUnitIds.add(unit.id);
        }
        continue;
      }

      const blockDescriptor = parseBlockUnitId(unit.id);
      if (blockDescriptor) {
        if (!blockFields.has(blockDescriptor.fieldName)) {
          rejectedFieldIds.push(unit.id);
          continue;
        }
        let workingValue = blockValues.get(blockDescriptor.fieldName);
        if (workingValue === undefined) {
          workingValue = createBlockImportBaseline(
            sourceSibling[blockDescriptor.fieldName],
            targetSibling?.[blockDescriptor.fieldName],
          );
        }
        if (!workingValue) {
          skipped.push({
            reason: `Ignored block unit "${unit.id}": block field is not a valid array`,
            collection,
            groupId,
            locale: document.targetLocale,
          });
          continue;
        }
        const result = applyBlockTranslationUnit({
          sourceValue: sourceSibling[blockDescriptor.fieldName],
          targetValue: workingValue,
          unit,
        });
        if (!result.ok) {
          if (!result.empty) {
            skipped.push({
              reason: `Ignored block unit "${unit.id}": ${result.reason}`,
              collection,
              groupId,
              locale: document.targetLocale,
            });
          }
          continue;
        }
        blockValues.set(blockDescriptor.fieldName, result.value);
        overrides[blockDescriptor.fieldName] = result.value;
        appliedUnitCount++;
        continue;
      }

      const fieldType = translatableFields.get(unit.id);
      if (!fieldType) {
        rejectedFieldIds.push(unit.id);
        continue;
      }

      if (fieldType === "richText") {
        const result = applyRichTextTranslationValue({
          sourceValue: sourceSibling[unit.id],
          targetValue: targetSibling?.[unit.id],
          sourceInline: unit.sourceInline,
          targetInline: unit.targetInline,
        });
        if (!result.ok) {
          if (!result.empty) {
            skipped.push({
              reason: `Ignored rich-text unit "${unit.id}": ${result.reason}`,
              collection,
              groupId,
              locale: document.targetLocale,
            });
          }
          continue;
        }
        overrides[unit.id] = result.value;
        appliedUnitCount++;
        continue;
      }

      if (unit.sourceInline || unit.targetInline) {
        skipped.push({
          reason: `Ignored atomic unit "${unit.id}" with rich-text inline codes`,
          collection,
          groupId,
          locale: document.targetLocale,
        });
        continue;
      }
      const liveSource = sourceSibling[unit.id];
      if (typeof liveSource !== "string" || unit.source !== liveSource) {
        skipped.push({
          reason: `Ignored atomic unit "${unit.id}": source text does not match the live document`,
          collection,
          groupId,
          locale: document.targetLocale,
        });
        continue;
      }
      if (unit.target.length === 0) continue;
      overrides[unit.id] = unit.target;
      appliedUnitCount++;
    }
    if (rejectedFieldIds.length > 0) {
      skipped.push({
        reason: `Ignored ${rejectedFieldIds.length} unit${rejectedFieldIds.length === 1 ? "" : "s"} with non-translatable id: ${rejectedFieldIds.join(", ")}`,
        collection,
        groupId,
        locale: document.targetLocale,
      });
    }
    if (Object.keys(overrides).length === 0) {
      if (skipped.length === documentSkipCount) {
        skipped.push({
          reason: "All target values in this document were empty",
          collection,
          groupId,
          locale: document.targetLocale,
        });
      }
      continue;
    }

    if (options.dryRun) {
      applied.push({
        collection,
        docId: targetSibling ? (targetSibling as { id: string }).id : "(would-create)",
        locale: document.targetLocale,
        operation: targetSibling ? "update" : "create",
        unitCount: appliedUnitCount,
      });
      continue;
    }

    if (targetSibling) {
      // UPDATE: preserve every other field and overlay just the
      // translatable ones the document covered.
      const merged = { ...targetSibling, ...overrides };
      // Strip framework-managed columns; the pipeline re-derives
      // them on save.
      const cleaned = npCollectionDocumentToWriteInput(merged, getCollectionConfig(collection));
      const result = await saveDocument(
        collection,
        (targetSibling as { id: string }).id,
        cleaned,
        options.user,
      );
      applied.push({
        collection,
        docId: result.doc.id as string,
        locale: document.targetLocale,
        operation: "update",
        unitCount: appliedUnitCount,
      });
    } else {
      // CREATE: two-step to mirror the admin TranslationTabs flow
      // and sidestep `applySlugField`'s "can't derive a slug from
      // a non-ASCII title" failure on the create path.
      //
      // Step 1: clone source content verbatim. The pipeline's
      // Zod validation strips `slug` (it isn't a declared field
      // — `slugField` is framework-managed), but the source's
      // ASCII title still derives a valid slug via `useField`.
      // Step 2: overlay the translator's target text. The
      // pipeline's `applySlugField` now hits the
      // `originalDoc.slug` fallback (the row from step 1), so
      // the non-ASCII translated title doesn't need to derive a
      // slug at all.
      const baseline = npCollectionDocumentToWriteInput(
        sourceSibling,
        getCollectionConfig(collection),
      );
      baseline.locale = document.targetLocale;
      baseline.translationGroupId = groupId;
      const created = await saveDocument(collection, null, baseline, options.user, {
        status: "draft",
      });
      const newId = created.doc.id as string;
      const result = await saveDocument(
        collection,
        newId,
        { ...baseline, ...overrides },
        options.user,
      );
      applied.push({
        collection,
        docId: result.doc.id as string,
        locale: document.targetLocale,
        operation: "create",
        unitCount: appliedUnitCount,
      });
    }
  }

  return {
    applied,
    skipped,
    wrote: !options.dryRun && applied.length > 0,
  };
}

export class NpTranslationApplyError extends Error {
  override readonly name = "NpTranslationApplyError";
}

function parseDocumentRoute(route: string): { collection: string; groupId: string } | null {
  // Match `{slug}/{uuid}` where slug is `[a-z0-9-]+` and groupId is
  // a UUID. We don't blindly split on `/` because some slugs may
  // contain `-` and a UUID looks like `xxxxxxxx-xxxx-...`; a
  // single `/` separator with a trailing UUID is unambiguous.
  const idx = route.lastIndexOf("/");
  if (idx <= 0 || idx === route.length - 1) return null;
  const collection = route.slice(0, idx);
  const groupId = route.slice(idx + 1);
  if (!/^[a-z0-9_-]+$/.test(collection)) return null;
  if (!isUuid(groupId)) return null;
  return { collection, groupId };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function findSibling(
  collection: string,
  groupId: string,
  locale: string,
  user: NpAuthUser | undefined,
): Promise<Record<string, unknown> | null> {
  const result = await findDocuments(
    collection,
    {
      limit: 1,
      page: 1,
      where: { translationGroupId: groupId },
      locale,
    },
    user,
  );
  const row = result.docs[0];
  if (!row) return null;
  // The findDocuments contract returns shallow rows — pull the
  // full doc through getDocumentById so we have every column the
  // create-path needs to clone (richText, blocks, etc.).
  const id = (row as { id?: string }).id;
  if (!id) return null;
  const full = await getDocumentById(collection, id, user);
  return full ?? null;
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
