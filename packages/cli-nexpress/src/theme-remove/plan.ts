import type { NpThemeManifest, NpThemeFieldRequirement } from "@nexpress/core";

/**
 * F.8 — pure planner for `theme remove`.
 *
 * Mirrors the install planner's stateless model: takes the
 * theme manifest's `requires` plus the operator's currently
 * installed collections, and produces an ordered list of
 * structured `ThemeRemoveStep`s the runner will execute.
 *
 * The planner is **add-only-aware**: it only proposes removing
 * fields the install planner would have added. If the operator
 * has put the same field there manually (or extended the
 * collection beyond the theme's spec), the planner has no way
 * to tell it apart — so the runner shows the diff and asks
 * for confirmation. This pre-public version trades that ambiguity
 * for state-file simplicity.
 *
 * `--with-collections` is gated on the file matching the theme's
 * expected shape exactly (only theme fields, no operator extras).
 * Files with extras surface as `keep-collection-with-warning`
 * rather than auto-deleting — the operator may have stored docs
 * with extra metadata.
 */

export type ThemeRemoveStep =
  | {
      kind: "remove-field";
      collection: string;
      field: string;
      requirement: NpThemeFieldRequirement;
    }
  | {
      kind: "remove-collection-file";
      collection: string;
      filePath: string;
    }
  | {
      kind: "keep-collection-with-warning";
      collection: string;
      reason: string;
      filePath: string;
    };

export interface ThemeRemovePlan {
  themeId: string;
  themeName: string;
  themeVersion: string;
  /** Steps the apply phase will execute. Empty when the theme's
   *  collections / fields are already absent — `isNoop` true. */
  steps: ThemeRemoveStep[];
  /** True when no steps. Apply phase exits cleanly without a
   *  prompt. */
  isNoop: boolean;
  /** Whether the plan was generated with `--with-collections`.
   *  Surfaces in the formatter so operators see what they're
   *  about to drop on disk. */
  withCollections: boolean;
}

/**
 * Inputs are the on-disk shape the runner extracted via AST.
 * Keeping the planner shape minimal (slug + filePath + field
 * names) lets us unit-test without parsing actual TS files.
 */
export interface PlanCollectionShape {
  slug: string;
  filePath: string;
  /** Top-level field names extracted from the collection's
   *  `fields: [...]` literal. Walks `row` / `collapsible` the
   *  same way the install patcher does, so containerized fields
   *  count toward the "exactly matches theme spec" check. */
  fieldNames: string[];
}

export interface PlanThemeRemoveInput {
  manifest: NpThemeManifest;
  /** The site's existing collections (after AST extraction).
   *  Only collections referenced by `manifest.requires` matter
   *  to the planner; others are left untouched. */
  existingCollections: PlanCollectionShape[];
  /** When true, propose deleting the entire collection file for
   *  collections whose on-disk shape matches the theme's spec
   *  exactly. Defaults to false: AST-remove fields only, leave
   *  the file. */
  withCollections: boolean;
}

export function planThemeRemove(input: PlanThemeRemoveInput): ThemeRemovePlan {
  const { manifest, existingCollections, withCollections } = input;
  const requires = manifest.requires?.collections ?? {};
  const byCollectionSlug = new Map<string, PlanCollectionShape>();
  for (const c of existingCollections) byCollectionSlug.set(c.slug, c);

  const steps: ThemeRemoveStep[] = [];

  for (const [slug, requirement] of Object.entries(requires)) {
    const onDisk = byCollectionSlug.get(slug);
    if (!onDisk) continue; // already gone — no-op for this collection

    const requiredFields = Object.keys(requirement.fields ?? {});
    const onDiskNames = new Set(onDisk.fieldNames);

    if (withCollections) {
      // Whole-file deletion: only safe when the on-disk shape
      // matches the theme spec exactly. Operators who added
      // their own fields to a theme-installed collection
      // probably have docs that depend on those fields — the
      // file stays, fields removed individually instead.
      const extras = onDisk.fieldNames.filter((name) => !requiredFields.includes(name));
      if (extras.length === 0) {
        steps.push({
          kind: "remove-collection-file",
          collection: slug,
          filePath: onDisk.filePath,
        });
        continue;
      }
      steps.push({
        kind: "keep-collection-with-warning",
        collection: slug,
        filePath: onDisk.filePath,
        reason:
          `${extras.length} field${extras.length === 1 ? "" : "s"} not declared by the theme: ` +
          extras.join(", "),
      });
      // Fall through to per-field removal so the theme-contributed
      // fields still come out even when we keep the file.
    }

    for (const [fieldName, fieldReq] of Object.entries(requirement.fields ?? {})) {
      if (!onDiskNames.has(fieldName)) continue; // already gone
      steps.push({
        kind: "remove-field",
        collection: slug,
        field: fieldName,
        requirement: fieldReq,
      });
    }
  }

  return {
    themeId: manifest.id,
    themeName: manifest.name,
    themeVersion: manifest.version,
    steps,
    isNoop: steps.length === 0,
    withCollections,
  };
}
