import type {
  NpCollectionConfig,
  NpFieldConfig,
  NpRelationshipField,
  NpThemeFieldRequirement,
  NpThemeManifest,
} from "../config/types.js";

/**
 * Phase F.1 — theme requirement check.
 *
 * Compares a theme's `manifest.requires` against the site's
 * registered collections and reports mismatches. The result
 * drives admin warnings on theme activation; F.8 will reuse
 * the same shape to drive the CLI patcher.
 *
 * "Hard" requirements (default) are normal mismatches the
 * operator should resolve. "Soft" requirements (`hard: false`)
 * are recorded separately so admin can show them at lower
 * severity — the theme renders without them but with degraded
 * behavior.
 */

export interface NpThemeRequirementMissingField {
  collection: string;
  field: string;
  expected: NpThemeFieldRequirement;
  hard: boolean;
}

export interface NpThemeRequirementTypeConflict {
  collection: string;
  field: string;
  expected: NpThemeFieldRequirement["type"];
  actual: string;
  hard: boolean;
}

export interface NpThemeRequirementRelationConflict {
  collection: string;
  field: string;
  expected: NonNullable<NpThemeFieldRequirement["relationTo"]>;
  actual: string | string[];
  hard: boolean;
}

export interface NpThemeRequirementResult {
  themeId: string;
  hasMismatches: boolean;
  /** Has at least one HARD mismatch — operator should resolve before activation. */
  hasHardMismatches: boolean;
  missingCollections: Array<{
    collection: string;
    createIfAbsent: boolean;
  }>;
  missingFields: NpThemeRequirementMissingField[];
  typeConflicts: NpThemeRequirementTypeConflict[];
  relationConflicts: NpThemeRequirementRelationConflict[];
}

/**
 * Walk a collection config's field tree and produce a flat
 * `name → field` map. Theme requirements address top-level
 * fields by name; the walker handles `row` / `collapsible`
 * containers (which inline their children) but not `array` /
 * `group` (which scope their children inside a sub-record —
 * theme requirements don't reach into those, by design).
 */
function flattenTopLevelFields(
  fields: NpFieldConfig[],
): Map<string, NpFieldConfig> {
  const out = new Map<string, NpFieldConfig>();
  for (const f of fields) {
    if (f.type === "row" || f.type === "collapsible") {
      for (const [name, child] of flattenTopLevelFields(f.fields)) {
        out.set(name, child);
      }
      continue;
    }
    if ("name" in f && typeof f.name === "string") {
      out.set(f.name, f);
    }
  }
  return out;
}

function relationToMatches(
  expected: NonNullable<NpThemeFieldRequirement["relationTo"]>,
  actual: NpRelationshipField["relationTo"],
): boolean {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const actualList = Array.isArray(actual) ? actual : [actual];
  // Theme expects every declared target to exist on the actual
  // field. Actual may include extras (theme isn't picky about
  // those) but must cover the expected set.
  return expectedList.every((e) => actualList.includes(e));
}

export function checkThemeRequirements(
  manifest: NpThemeManifest,
  collections: NpCollectionConfig[],
): NpThemeRequirementResult {
  const result: NpThemeRequirementResult = {
    themeId: manifest.id,
    hasMismatches: false,
    hasHardMismatches: false,
    missingCollections: [],
    missingFields: [],
    typeConflicts: [],
    relationConflicts: [],
  };

  const requires = manifest.requires?.collections;
  if (!requires) return result;

  const bySlug = new Map(collections.map((c) => [c.slug, c]));

  for (const [slug, req] of Object.entries(requires)) {
    const collection = bySlug.get(slug);
    if (!collection) {
      result.missingCollections.push({
        collection: slug,
        createIfAbsent: req.createIfAbsent ?? false,
      });
      continue;
    }
    if (!req.fields) continue;

    const fieldMap = flattenTopLevelFields(collection.fields);
    for (const [fieldName, fieldReq] of Object.entries(req.fields)) {
      const hard = fieldReq.hard ?? true;
      const actual = fieldMap.get(fieldName);
      if (!actual) {
        result.missingFields.push({
          collection: slug,
          field: fieldName,
          expected: fieldReq,
          hard,
        });
        continue;
      }
      if (actual.type !== fieldReq.type) {
        result.typeConflicts.push({
          collection: slug,
          field: fieldName,
          expected: fieldReq.type,
          actual: actual.type,
          hard,
        });
        continue;
      }
      if (
        fieldReq.type === "relationship" &&
        fieldReq.relationTo &&
        actual.type === "relationship"
      ) {
        if (
          !relationToMatches(
            fieldReq.relationTo,
            actual.relationTo,
          )
        ) {
          result.relationConflicts.push({
            collection: slug,
            field: fieldName,
            expected: fieldReq.relationTo,
            actual: actual.relationTo,
            hard,
          });
        }
      }
    }
  }

  const hardMismatches =
    result.missingCollections.length > 0 ||
    result.missingFields.some((m) => m.hard) ||
    result.typeConflicts.some((c) => c.hard) ||
    result.relationConflicts.some((c) => c.hard);
  const anyMismatches =
    result.missingCollections.length > 0 ||
    result.missingFields.length > 0 ||
    result.typeConflicts.length > 0 ||
    result.relationConflicts.length > 0;

  result.hasHardMismatches = hardMismatches;
  result.hasMismatches = anyMismatches;
  return result;
}
