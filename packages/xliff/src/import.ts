import {
  findDocuments,
  getCollectionConfig,
  getDocumentById,
  getI18nConfig,
  saveDocument,
  type NxAuthUser,
} from "@nexpress/core";

import { parseXliff } from "./format.js";

/**
 * Field types whose values round-trip through XLIFF — kept in
 * sync with the export side so import accepts exactly what
 * export emits. Hand-edited XLIFFs that reference non-string
 * field types (richText, blocks, relationships, etc.) are
 * rejected.
 */
const TRANSLATABLE_TYPES = new Set(["text", "textarea", "email"]);

export interface XliffImportOptions {
  /** XLIFF 1.2 XML body to apply. */
  xml: string;
  /** Actor recorded on writes (createdBy / updatedBy / audit). */
  user: NxAuthUser;
  /**
   * When true, parses + resolves siblings + reports what would
   * happen, but writes nothing. Useful for previewing a
   * translator's bundle before applying.
   */
  dryRun?: boolean;
}

export interface XliffImportApplied {
  collection: string;
  /** Document id that was created or updated. */
  docId: string;
  locale: string;
  operation: "create" | "update";
  /** Number of trans-units actually written for this doc. */
  unitCount: number;
}

export interface XliffImportSkip {
  reason: string;
  collection?: string;
  groupId?: string;
  locale?: string;
}

export interface XliffImportResult {
  applied: XliffImportApplied[];
  skipped: XliffImportSkip[];
  /**
   * Whether this run actually touched the database. False when
   * `dryRun: true` or when every file matched a `skipped` rule.
   */
  wrote: boolean;
}

/**
 * Apply a translator's XLIFF bundle. For each `<file>`:
 *
 *   1. Parse `original` as `{collectionSlug}/{translationGroupId}`.
 *   2. Look up the source-locale sibling (used as the canonical
 *      shape when creating a new target row — non-translatable
 *      fields are copied across).
 *   3. Look up the target-locale sibling. If found, UPDATE its
 *      translatable fields with each unit's `<target>`. If not,
 *      CREATE a new sibling using the source data + `<target>`
 *      values for translatable fields.
 *
 * Empty `<target>` text is skipped — a translator who hasn't yet
 * translated that unit shouldn't blank out an existing target.
 * If every unit in a file has an empty target, the file is
 * recorded as skipped rather than landing an empty draft.
 *
 * Errors per file are isolated: a malformed `original` or a
 * missing source sibling adds a `skipped` entry but the rest of
 * the bundle still applies. Throwing is reserved for global
 * problems (i18n not configured, malformed XML).
 */
export async function importXliff(
  options: XliffImportOptions,
): Promise<XliffImportResult> {
  const i18n = getI18nConfig();
  if (!i18n) {
    throw new XliffImportError(
      "i18n is not configured — call setI18nConfig() before importing XLIFF",
    );
  }

  const doc = parseXliff(options.xml);
  const applied: XliffImportApplied[] = [];
  const skipped: XliffImportSkip[] = [];

  for (const file of doc.files) {
    const parsed = parseOriginal(file.original);
    if (!parsed) {
      skipped.push({
        reason: `Malformed file original "${file.original}" (expected "{collection}/{groupId}")`,
      });
      continue;
    }
    const { collection, groupId } = parsed;

    if (!i18n.locales.includes(file.targetLocale)) {
      skipped.push({
        reason: `Target locale "${file.targetLocale}" is not configured`,
        collection,
        groupId,
        locale: file.targetLocale,
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
        locale: file.targetLocale,
      });
      continue;
    }
    if (!config.i18n) {
      skipped.push({
        reason: `Collection "${collection}" is not i18n-enabled`,
        collection,
        groupId,
        locale: file.targetLocale,
      });
      continue;
    }

    // Whitelist of `trans-unit` ids the importer will honor —
    // matches the export side's translatable-types contract
    // (text / textarea / email). Anything else is rejected with
    // a `skipped` entry rather than silently spread onto the
    // row: a malicious or hand-edited XLIFF that ships e.g.
    // `<trans-unit id="locale">` could otherwise mutate the
    // sibling's locale or `translation_group_id` (i18n columns
    // pass through Zod by design) and corrupt the
    // (locale, translationGroupId) sibling structure.
    const translatableNames = new Set(
      config.fields
        .filter((f) => "name" in f && TRANSLATABLE_TYPES.has(f.type))
        .map((f) => (f as { name: string }).name),
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
      file.sourceLocale,
      options.user,
    );
    if (!sourceSibling) {
      skipped.push({
        reason: `No source row for groupId=${groupId} locale=${file.sourceLocale}`,
        collection,
        groupId,
        locale: file.targetLocale,
      });
      continue;
    }

    const targetSibling = await findSibling(
      collection,
      groupId,
      file.targetLocale,
      options.user,
    );

    // Build the field overrides from non-empty `<target>` units
    // whose id matches a translatable field on this collection.
    const overrides: Record<string, string> = {};
    const rejectedFieldIds: string[] = [];
    for (const unit of file.units) {
      if (unit.target.length === 0) continue;
      if (!translatableNames.has(unit.id)) {
        rejectedFieldIds.push(unit.id);
        continue;
      }
      overrides[unit.id] = unit.target;
    }
    if (rejectedFieldIds.length > 0) {
      skipped.push({
        reason: `Ignored ${rejectedFieldIds.length} unit${rejectedFieldIds.length === 1 ? "" : "s"} with non-translatable id: ${rejectedFieldIds.join(", ")}`,
        collection,
        groupId,
        locale: file.targetLocale,
      });
    }
    if (Object.keys(overrides).length === 0) {
      skipped.push({
        reason: "All <target> elements in this file were empty",
        collection,
        groupId,
        locale: file.targetLocale,
      });
      continue;
    }

    if (options.dryRun) {
      applied.push({
        collection,
        docId: targetSibling
          ? (targetSibling as { id: string }).id
          : "(would-create)",
        locale: file.targetLocale,
        operation: targetSibling ? "update" : "create",
        unitCount: Object.keys(overrides).length,
      });
      continue;
    }

    if (targetSibling) {
      // UPDATE: preserve every other field and overlay just the
      // translatable ones the file covered.
      const merged = { ...targetSibling, ...overrides };
      // Strip framework-managed columns; the pipeline re-derives
      // them on save.
      const cleaned = stripFrameworkFields(merged);
      const result = await saveDocument(
        collection,
        (targetSibling as { id: string }).id,
        cleaned,
        options.user,
      );
      applied.push({
        collection,
        docId: result.doc.id as string,
        locale: file.targetLocale,
        operation: "update",
        unitCount: Object.keys(overrides).length,
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
      // Step 2: overlay the translator's `<target>` text. The
      // pipeline's `applySlugField` now hits the
      // `originalDoc.slug` fallback (the row from step 1), so
      // the non-ASCII translated title doesn't need to derive a
      // slug at all.
      const baseline = stripFrameworkFields({ ...sourceSibling });
      baseline.locale = file.targetLocale;
      baseline.translationGroupId = groupId;
      const created = await saveDocument(
        collection,
        null,
        baseline,
        options.user,
        { status: "draft" },
      );
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
        locale: file.targetLocale,
        operation: "create",
        unitCount: Object.keys(overrides).length,
      });
    }
  }

  return {
    applied,
    skipped,
    wrote: !options.dryRun && applied.length > 0,
  };
}

export class XliffImportError extends Error {
  override readonly name = "XliffImportError";
}

function parseOriginal(
  original: string,
): { collection: string; groupId: string } | null {
  // Match `{slug}/{uuid}` where slug is `[a-z0-9-]+` and groupId is
  // a UUID. We don't blindly split on `/` because some slugs may
  // contain `-` and a UUID looks like `xxxxxxxx-xxxx-...`; a
  // single `/` separator with a trailing UUID is unambiguous.
  const idx = original.lastIndexOf("/");
  if (idx <= 0 || idx === original.length - 1) return null;
  const collection = original.slice(0, idx);
  const groupId = original.slice(idx + 1);
  if (!/^[a-z0-9_-]+$/.test(collection)) return null;
  if (!isUuid(groupId)) return null;
  return { collection, groupId };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function findSibling(
  collection: string,
  groupId: string,
  locale: string,
  user: NxAuthUser | undefined,
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
  return (full as Record<string, unknown>) ?? null;
}

const FRAMEWORK_FIELDS = new Set([
  "id",
  "status",
  "_status",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "searchVector",
]);

function stripFrameworkFields(
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (FRAMEWORK_FIELDS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
