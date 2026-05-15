import type {
  NpCollectionConfig,
  NpFieldConfig,
  NpRegisteredTheme,
  NpThemeCollectionKind,
  NpThemeCollectionRequirement,
  NpThemeFieldRequirement,
} from "../config/types.js";
import { getScopedLogger } from "../observability/logger.js";

/**
 * Auto-merge themes' `manifest.requires.collections` into the
 * operator-authored `collections` array at config-resolution
 * time.
 *
 * Why this exists: the v0.2 theme contract lets themes declare
 * the collection fields their components depend on
 * (`requires.collections.<slug>.fields.<name>`). Pre-#F-track this
 * was wired up exclusively through `pnpm nexpress theme:install`,
 * which AST-patched the operator's `src/collections/*.ts`. That
 * "code-write" felt heavyweight for what is, conceptually, a
 * package add — and surfaced bugs (#604, #605, #606) at the
 * intersection of file naming, registration, and missing
 * directories.
 *
 * The framework-side merge replaces it: as soon as the operator
 * adds a theme to `themes: [...]`, `defineConfig` walks each
 * theme's `requires.collections` and:
 *
 *   - For each existing collection slug, appends the theme's
 *     fields to that collection's `fields` array (only when the
 *     operator hasn't already declared a field with the same
 *     name — operator wins).
 *   - For each slug that doesn't yet exist AND the theme set
 *     `createIfAbsent: true`, synthesises a minimal
 *     `NpCollectionConfig` and pushes it onto `collections`.
 *
 * The merge is non-destructive: operator-authored fields are
 * never overwritten or reshaped. Theme-injected fields default
 * to `required: false` regardless of `req.required` because they
 * land on existing rows that don't have a value yet — a hard NOT
 * NULL constraint would block the very next migration. Theme
 * authors that NEED a value can validate in their template /
 * read path. Inheriting `hard: false` from the requirement just
 * means "lower-severity admin warning"; field-level `required`
 * is the runtime/codegen concern.
 *
 * The next `pnpm db:generate && pnpm db:migrate` picks up the
 * injected columns. From the operator's perspective: add a theme
 * to `themes:`, run the two-command migration, done.
 */

/**
 * Resolved lazily so `setLogger()` calls made AFTER this module
 * is first imported (e.g. tests, host apps that swap to pino at
 * boot) still feed the merge's warnings. The scoped bindings
 * are constant, so re-creating per call is cheap.
 */
function log(): ReturnType<typeof getScopedLogger> {
  return getScopedLogger({ component: "config:theme-merge" });
}

/**
 * Field requirement types we know how to synthesise into a
 * concrete `NpFieldConfig` at merge time. `select` is excluded:
 * `NpThemeFieldRequirement` has no `options` array, and the
 * validation schema (`fieldSchema`) requires `options.min(1)`,
 * so a synthesised select would crash boot. `upload` lands here
 * but requires `relationTo` on the requirement itself; we skip
 * with a warning when it's absent.
 */
const SUPPORTED_REQUIREMENT_TYPES = new Set<NpThemeFieldRequirement["type"]>([
  "text",
  "textarea",
  "richText",
  "number",
  "checkbox",
  "date",
  "upload",
  "relationship",
  "blocks",
]);

/**
 * Translate a single field requirement into a concrete
 * `NpFieldConfig`. Returns null when the requirement can't be
 * sensibly materialised without further input (e.g. `select`
 * without options, `upload` without `relationTo`). The caller
 * logs a warning so the operator sees what was skipped.
 */
function requirementToField(
  name: string,
  req: NpThemeFieldRequirement,
): NpFieldConfig | null {
  switch (req.type) {
    case "text":
    case "textarea":
    case "richText":
    case "number":
    case "checkbox":
    case "date":
    case "blocks":
      // Plain scalar/blob fields — type + name is enough. We
      // deliberately do NOT forward `req.required: true` onto
      // the field. Theme-injected fields land on existing rows
      // that have no value; making them NOT NULL blocks the
      // very next migration. Theme authors that need a non-null
      // guarantee enforce it in their template/read path.
      return { type: req.type, name };
    case "upload": {
      if (!req.relationTo || Array.isArray(req.relationTo)) {
        log().warn(
          "Skipping theme-required upload field: requirement is missing a scalar `relationTo`.",
          { field: name, relationTo: req.relationTo },
        );
        return null;
      }
      return {
        type: "upload",
        name,
        relationTo: req.relationTo,
      };
    }
    case "relationship": {
      if (!req.relationTo) {
        log().warn(
          "Skipping theme-required relationship field: requirement is missing `relationTo`.",
          { field: name },
        );
        return null;
      }
      const baseField = {
        type: "relationship" as const,
        name,
        relationTo: req.relationTo,
      };
      return req.hasMany ? { ...baseField, hasMany: true } : baseField;
    }
    case "select": {
      // A theme can synthesise a select when it provides at least
      // one option on the requirement (universal-content-model
      // Phase U.1 #748). Without options the field schema would
      // reject the synthesised config (`options.min(1)`), so a
      // contribution with no options is still a no-op + warning.
      // Themes that contribute options to an EXISTING select don't
      // come through here — that path unions options inside
      // `mergeThemeRequirements`.
      if (!req.options || req.options.length === 0) {
        log().warn(
          "Skipping theme-required select field: requirement is missing an `options` list.",
          { field: name },
        );
        return null;
      }
      return {
        type: "select",
        name,
        options: [...req.options],
      };
    }
    default: {
      // Exhaustiveness — adding a requirement type forces an
      // update here. Cast through `never` so a missed case is a
      // compile error, not a silent skip.
      const _exhaustive: never = req.type;
      void _exhaustive;
      log().warn("Unknown theme field requirement type; skipping.", {
        field: name,
        type: req.type as unknown as string,
      });
      return null;
    }
  }
}

/**
 * Universal-content-model Phase U.1 (#748): union two select
 * option lists. Dedupe on `value` (so two themes contributing
 * the same kind don't double up); last-wins on `label` (theme B
 * loaded after theme A can re-label the shared option).
 *
 * Returns the original `base` array unchanged when the
 * contribution is empty or adds no new values — callers use
 * referential equality to decide whether to clone the field.
 */
function mergeSelectOptions(
  base: ReadonlyArray<{ label: string; value: string }>,
  contribution: ReadonlyArray<{ label: string; value: string }>,
): Array<{ label: string; value: string }> | ReadonlyArray<{ label: string; value: string }> {
  if (contribution.length === 0) return base;
  const byValue = new Map(base.map((o) => [o.value, o]));
  let changed = false;
  for (const opt of contribution) {
    const existing = byValue.get(opt.value);
    if (!existing) {
      byValue.set(opt.value, opt);
      changed = true;
    } else if (existing.label !== opt.label) {
      // Last-wins on label — keep value stable, refresh label.
      byValue.set(opt.value, opt);
      changed = true;
    }
  }
  if (!changed) return base;
  return Array.from(byValue.values());
}

/**
 * Set of names already declared on a collection. Walks
 * containers (`row`, `collapsible`) like the requirement
 * checker does so a field declared inside a row counts as
 * present. `array` / `group` are NOT walked — theme requirements
 * address top-level fields by name and shouldn't merge into
 * nested record scopes.
 */
function collectExistingFieldNames(fields: NpFieldConfig[]): Set<string> {
  const names = new Set<string>();
  for (const f of fields) {
    if (f.type === "row" || f.type === "collapsible") {
      for (const name of collectExistingFieldNames(f.fields)) {
        names.add(name);
      }
      continue;
    }
    if ("name" in f && typeof f.name === "string") {
      names.add(f.name);
    }
  }
  return names;
}

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function synthesiseCollection(
  slug: string,
  requirement: NpThemeCollectionRequirement,
  injectedNames: Set<string>,
  themeId: string,
): NpCollectionConfig | null {
  const fields: NpFieldConfig[] = [];
  for (const [fieldName, fieldReq] of Object.entries(requirement.fields ?? {})) {
    if (!SUPPORTED_REQUIREMENT_TYPES.has(fieldReq.type)) {
      // requirementToField will log the skip — call through so
      // the warning fires from a single place.
      const synth = requirementToField(fieldName, fieldReq);
      if (synth) fields.push(synth);
      continue;
    }
    const synth = requirementToField(fieldName, fieldReq);
    if (synth) {
      fields.push(synth);
      injectedNames.add(fieldName);
    }
  }
  if (fields.length === 0) {
    log().warn(
      "Theme requested createIfAbsent for a collection with no synthesisable fields; skipping.",
      { slug },
    );
    return null;
  }
  const titled = titleCase(slug);
  const singular = slug.endsWith("s") ? titleCase(slug.slice(0, -1)) : titled;
  // `_themeOrigin` is the admin's signal that this collection
  // only exists because the named theme's `createIfAbsent`
  // synthesised it. The admin sidebar hides such entries when
  // the owning theme isn't the active one — the bundled-themes
  // prebake materialises every built-in's createIfAbsent slug,
  // but only the active theme's deserve sidebar real estate.
  return {
    slug,
    labels: { singular, plural: titled },
    fields,
    admin: { _themeOrigin: themeId },
  };
}

interface MergeStats {
  /** Names injected per slug for telemetry / debugging. */
  injected: Map<string, Set<string>>;
  createdSlugs: Set<string>;
}

/**
 * Walks every theme on `themes` and unions its
 * `manifest.requires.collections` into `collections`. Returns a
 * NEW array (and new nested objects where modified) so the
 * function is safe to feed a frozen / re-used config object.
 *
 * Conflict resolution:
 *   - Operator-declared field with the same name → keep the
 *     operator's; do NOT overwrite.
 *   - Two themes contribute the same field name on the same
 *     slug → first theme wins, subsequent themes log a
 *     `config:theme-merge` warning and skip.
 *   - Theme declares a slug that doesn't exist and DOESN'T set
 *     `createIfAbsent` → no-op (admin still surfaces the
 *     mismatch via `checkThemeRequirements` so the operator can
 *     decide whether to add the collection manually).
 */
export function mergeThemeRequirements(
  collections: NpCollectionConfig[],
  themes: NpRegisteredTheme[] | undefined,
): NpCollectionConfig[] {
  if (!themes || themes.length === 0) return collections;

  const stats: MergeStats = {
    injected: new Map(),
    createdSlugs: new Set(),
  };
  // Work on a shallow-copied array; we clone individual
  // collections only when we need to mutate their `fields`.
  const merged: NpCollectionConfig[] = collections.slice();
  const indexBySlug = new Map<string, number>(
    merged.map((c, i) => [c.slug, i]),
  );
  // Track which fields already exist (operator-declared OR
  // earlier-theme-injected) per slug. Initialise with the
  // operator's view so we never overwrite a user-authored field.
  const existingFieldsBySlug = new Map<string, Set<string>>(
    merged.map((c) => [c.slug, collectExistingFieldNames(c.fields)]),
  );

  for (const theme of themes) {
    const requires = theme.manifest.requires?.collections;
    if (!requires) continue;
    for (const [slug, req] of Object.entries(requires)) {
      const existingIndex = indexBySlug.get(slug);
      if (existingIndex === undefined) {
        if (!req.createIfAbsent) continue;
        const injectedNames = new Set<string>();
        const synth = synthesiseCollection(slug, req, injectedNames, theme.manifest.id);
        if (!synth) continue;
        merged.push(synth);
        indexBySlug.set(slug, merged.length - 1);
        existingFieldsBySlug.set(slug, injectedNames);
        stats.createdSlugs.add(slug);
        stats.injected.set(slug, injectedNames);
        continue;
      }

      // Existing collection — append the theme's fields that
      // aren't already present (or, for select fields, union the
      // options into the existing select), and stamp the kinds
      // metadata. A theme that contributes only `kinds` (no
      // `fields`) still gets the merge — the early skip on
      // missing fields would have dropped it pre-#750.
      const reqFields = req.fields;
      const reqKinds = req.kinds;
      if (!reqFields && !reqKinds) continue;

      const alreadyDeclared = existingFieldsBySlug.get(slug) ?? new Set<string>();
      const target = merged[existingIndex];
      if (!target) continue; // defensive; the index was just looked up
      let nextFields: NpFieldConfig[] = target.fields;
      let fieldsCloned = false;
      const ensureCloned = (): NpFieldConfig[] => {
        if (!fieldsCloned) {
          nextFields = [...nextFields];
          fieldsCloned = true;
        }
        return nextFields;
      };

      for (const [fieldName, fieldReq] of Object.entries(reqFields ?? {})) {
        if (alreadyDeclared.has(fieldName)) {
          // Select-options union (universal-content-model Phase U.1).
          // When both sides are `select`, the requirement's
          // `options` add to the existing field's options instead
          // of being skipped. Two themes contributing disjoint
          // option sets (e.g. `kind=doc` + `kind=project`) is
          // exactly the case this enables.
          if (fieldReq.type === "select" && fieldReq.options && fieldReq.options.length > 0) {
            const idx = nextFields.findIndex(
              (f) => "name" in f && f.name === fieldName,
            );
            const existing = idx >= 0 ? nextFields[idx] : undefined;
            if (existing && existing.type === "select") {
              const merged = mergeSelectOptions(existing.options, fieldReq.options);
              if (merged !== existing.options) {
                const list = ensureCloned();
                // Spread copy ensures the result is a fresh mutable
                // array even when `mergeSelectOptions` returned the
                // input untouched in a code path the caller doesn't
                // see; cheap, removes the readonly union in the type.
                list[idx] = { ...existing, options: [...merged] };
              }
              continue;
            }
            // Falls through to the same-name warning path when the
            // existing field isn't a select — a select requirement
            // can't union into a text / number / etc.
          }

          // If this name was injected by an earlier theme on
          // this same merge pass, surface that explicitly —
          // operators reading the log can tell "operator wins"
          // (silent) apart from "theme A wins over theme B"
          // (warned). Operator-declared field collisions are
          // expected and unsurprising; theme-vs-theme collisions
          // are usually a misconfiguration.
          const injectedHere = stats.injected.get(slug);
          if (injectedHere?.has(fieldName)) {
            log().warn(
              "Two themes contribute the same field on the same collection; keeping the first.",
              { slug, field: fieldName, theme: theme.manifest.id },
            );
          }
          continue;
        }
        const synth = requirementToField(fieldName, fieldReq);
        if (!synth) continue;
        ensureCloned().push(synth);
        alreadyDeclared.add(fieldName);
        let injectedHere = stats.injected.get(slug);
        if (!injectedHere) {
          injectedHere = new Set<string>();
          stats.injected.set(slug, injectedHere);
        }
        injectedHere.add(fieldName);
      }

      // Kinds metadata (universal-content-model #748). Themes
      // contribute one entry per kind they author; the merge
      // unions across themes and stamps the result onto
      // `target.admin.kinds`. Last-write-wins on per-kind props
      // (label, icon, urlPattern, …) — two themes claiming the
      // same kind value is unusual and the second theme's
      // description wins.
      //
      // Each merged kind carries a `_themeOrigin` tag so the
      // admin sidebar can hide kinds whose contributing theme
      // isn't active. Without this, the bundled-themes prebake
      // would surface every built-in theme's kinds on every
      // operator's sidebar — an operator on `default` would see
      // a "Documentation" entry contributed by `theme-docs`
      // (#754 follow-up).
      let nextAdmin = target.admin;
      let adminCloned = false;
      if (reqKinds && Object.keys(reqKinds).length > 0) {
        const existingKinds = target.admin?.kinds ?? {};
        const mergedKinds = { ...existingKinds };
        for (const [kindValue, kindMeta] of Object.entries(reqKinds)) {
          mergedKinds[kindValue] = {
            ...(mergedKinds[kindValue] ?? {}),
            ...kindMeta,
            _themeOrigin: theme.manifest.id,
          };
        }
        nextAdmin = { ...(target.admin ?? {}), kinds: mergedKinds };
        adminCloned = true;
      }

      if (!fieldsCloned && !adminCloned) continue;

      // Clone the collection record + its fields / admin so we
      // don't mutate the operator's defineCollection() output.
      // Mutating the caller's array would surprise consumers that
      // re-use collection objects (tests, multi-site sandboxes).
      merged[existingIndex] = {
        ...target,
        ...(fieldsCloned ? { fields: nextFields } : {}),
        ...(adminCloned ? { admin: nextAdmin } : {}),
      };
      existingFieldsBySlug.set(slug, alreadyDeclared);
    }
  }

  return merged;
}

/**
 * Type re-export — `NpThemeCollectionKind` is imported as a value
 * here only so consumers of `mergeThemeRequirements` don't have to
 * pull the same type from `../config/types.js` separately.
 */
export type { NpThemeCollectionKind };
