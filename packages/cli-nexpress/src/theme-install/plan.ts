import type {
  NpThemeRequirementResult,
  NpThemeManifest,
  NpThemeCollectionRequirement,
  NpThemeFieldRequirement,
} from "@nexpress/core";

/**
 * Phase F.8-A — pure planner. Takes a theme manifest's
 * `requires` plus the site's existing collection configs and
 * produces an ordered list of structured `ThemeInstallStep`s
 * the apply phase (F.8-B) will execute.
 *
 * Pure: no FS reads / writes. Tests pass mocked manifest +
 * collection list. The runner (`run.ts`) is the side-effecty
 * caller that loads the theme module, reads the on-disk
 * collections, and renders the formatter's output to stdout.
 */

export type ThemeInstallStep =
  | {
      kind: "create-collection";
      collection: string;
      requirement: NpThemeCollectionRequirement;
    }
  | {
      kind: "patch-collection";
      collection: string;
      addFields: Array<{
        name: string;
        requirement: NpThemeFieldRequirement;
      }>;
    }
  | {
      kind: "warn-soft-mismatch";
      collection: string;
      field: string;
      reason: string;
    };

export interface ThemeInstallPlan {
  themeId: string;
  themeName: string;
  themeVersion: string;
  /** Steps the apply phase will execute (F.8-B). Empty when
   *  the site already satisfies every hard requirement and
   *  there are no soft mismatches to flag. */
  steps: ThemeInstallStep[];
  /** Hard mismatches that block CLI install — operator must
   *  resolve manually (e.g. type conflict on existing field).
   *  Apply phase will refuse to proceed when this list is
   *  non-empty. */
  blockers: Array<{
    collection: string;
    field: string;
    expected: string;
    actual: string;
  }>;
  /** True when the plan would be a no-op (no steps, no blockers).
   *  Apply phase exits cleanly without prompting. */
  isNoop: boolean;
}

export interface PlanThemeInstallInput {
  manifest: NpThemeManifest;
  /** The site's existing collections. Caller (runner) reads
   *  these from `nexpress.config.ts`. */
  existingCollectionSlugs: string[];
  /** Result of `checkThemeRequirements(manifest, configs)`.
   *  Pre-computed by the runner so this planner stays pure. */
  check: NpThemeRequirementResult;
}

export function planThemeInstall(
  input: PlanThemeInstallInput,
): ThemeInstallPlan {
  const { manifest, existingCollectionSlugs, check } = input;
  const steps: ThemeInstallStep[] = [];
  const blockers: ThemeInstallPlan["blockers"] = [];
  const requires = manifest.requires?.collections ?? {};
  const existingSet = new Set(existingCollectionSlugs);

  // Order: new collections first, then field patches per
  // collection (in declaration order from the manifest).
  for (const slug of Object.keys(requires)) {
    if (!existingSet.has(slug)) {
      const requirement = requires[slug]!;
      steps.push({ kind: "create-collection", collection: slug, requirement });
    }
  }

  // Field-level patches against existing collections — only
  // include fields that are MISSING (per the check).
  // Type-conflict fields go into `blockers` instead.
  const missingByCollection = new Map<string, typeof check.missingFields>();
  for (const m of check.missingFields) {
    if (!m.hard) {
      // Soft requirement — not patched, just warned.
      steps.push({
        kind: "warn-soft-mismatch",
        collection: m.collection,
        field: m.field,
        reason: "soft requirement (hard:false)",
      });
      continue;
    }
    const list = missingByCollection.get(m.collection) ?? [];
    list.push(m);
    missingByCollection.set(m.collection, list);
  }
  for (const [slug, missing] of missingByCollection) {
    if (!existingSet.has(slug)) continue; // covered by create-collection
    steps.push({
      kind: "patch-collection",
      collection: slug,
      addFields: missing.map((m) => ({
        name: m.field,
        requirement: m.expected,
      })),
    });
  }

  // Type / relation conflicts go to blockers — the apply phase
  // refuses these (operator has to manually reconcile).
  for (const c of check.typeConflicts) {
    if (!c.hard) continue;
    blockers.push({
      collection: c.collection,
      field: c.field,
      expected: c.expected,
      actual: c.actual,
    });
  }
  for (const r of check.relationConflicts) {
    if (!r.hard) continue;
    blockers.push({
      collection: r.collection,
      field: r.field,
      expected: `relationship → ${
        Array.isArray(r.expected) ? r.expected.join(" | ") : r.expected
      }`,
      actual: `relationship → ${
        Array.isArray(r.actual) ? r.actual.join(" | ") : r.actual
      }`,
    });
  }

  return {
    themeId: manifest.id,
    themeName: manifest.name,
    themeVersion: manifest.version,
    steps,
    blockers,
    isNoop: steps.length === 0 && blockers.length === 0,
  };
}
