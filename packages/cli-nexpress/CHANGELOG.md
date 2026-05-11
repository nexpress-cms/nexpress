# @nexpress/cli

## 0.2.0

### Minor Changes

- 32e67ee: **v0.3 (B) — `--apply` flag for `theme:install` and `theme:uninstall`.**

  Closes a v0.3-deferred item from `docs/design/theme-v0.2-extension.md`
  §10:

  > `theme:install` auto-chains `db:migrate` — v0.2 keeps the DB-write
  > boundary explicit so the operator reviews the staged collection
  > diff (and the generated migration SQL) before it hits the database.
  > A `--apply` flag … is a clean v0.3 addition once the safety story
  > for AST patching has shipped real-world miles.

  ### What changed

  | Command           | Default                                                                                              | `--apply`                                                         |
  | ----------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
  | `theme:install`   | AST-patch → `db:generate` → STOP. Operator runs `db:migrate` manually.                               | AST-patch → `db:generate` → `db:migrate`. One-shot install.       |
  | `theme:uninstall` | AST-unpatch → `db:generate` → STOP. Operator runs `db:migrate` manually after reviewing DROP COLUMN. | AST-unpatch → `db:generate` → `db:migrate`. The DROP COLUMN runs. |

  The default stays explicit — operators new to NexPress get the
  safety net of reviewing generated SQL before it touches the
  database. `--apply` is opt-in for operators who've shipped enough
  theme installs to trust the staged diff.

  ### Confirm-prompt copy

  When `--apply` is set, the confirmation prompt explicitly mentions
  "will also run db:generate AND db:migrate" so the operator sees the
  full impact before pressing `y`. For uninstall, the destructive
  warning gains "(the latter DROPs columns)".

  ### Failure modes

  | Phase                          | Behavior                                                                                                                                |
  | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
  | Generate fails                 | `--apply` skipped; manual hint printed, exit 0 (the AST changes are still in place; operator fixes generate then runs migrate manually) |
  | Migrate fails (with `--apply`) | Exit 1; operator reviews `git diff` and runs `pnpm db:migrate` manually after reconciling                                               |

  ### Combined with `--yes`

  Orthogonal flags. `--yes --apply` makes the install/uninstall fully
  non-interactive (CI-friendly). `--apply` alone still prompts.
  `--yes` alone still stops after `db:generate`.

- 50b57fb: **Phase F.8-B — `nexpress theme:install` apply phase.**

  Second half of the v0.2 theme contract's CLI installer (design
  doc §4.8). Operators can now run `pnpm nexpress theme:install
<pkg>` end-to-end: the planner from F.8-A surfaces the diff,
  and the apply phase mutates `src/collections/*.ts` files,
  generates new ones, and (best-effort) spawns
  `pnpm db:generate` so the drizzle migration lands alongside
  the staged collection edits.

  This is the highest-risk piece in the v0.2 extension because it
  mutates live operator config files. The split from F.8-A keeps
  the AST mutation review focused.

  ### What this PR ships

  #### AST extractor — `extract-collection.ts`

  Reads each `src/collections/*.ts`, walks the `defineCollection({...})`
  call's argument literal, and synthesizes a partial
  `NpCollectionConfig` (slug + fields) the planner passes to
  `checkThemeRequirements`. Replaces F.8-A's regex slug-only
  discovery, surfacing real field-level diffs.

  Limitations (documented in source):
  - **Static-only**: no operator code is executed. Fields whose
    `type` or `name` are computed (variables, function calls)
    are skipped silently.
  - Walks `row` / `collapsible` containers (mirrors runtime walker).
  - Does NOT descend into `array` / `group` sub-records (mirrors
    runtime walker — theme requirements are top-level only).

  #### AST patcher — `patch-collection.ts`

  Adds missing fields to an existing `defineCollection({ fields:
[...] })` array. Hard safety invariants:
  - **Add-only.** Existing fields never modified or removed.
    Type conflicts surface as `blockers` BEFORE the patcher runs.
  - **Idempotent.** Field already present → skipped silently
    (`PatchResult.skipped`).
  - **Atomic per file.** All requested fields land or none do
    (single `saveSync()` call after every mutation; throws
    before save leave the file untouched).
  - **Conflict abort.** No `defineCollection({ fields })` shape
    found → `CollectionPatchError` thrown, caller aborts the
    whole apply.

  #### New collection file generator — `generate-collection.ts`

  Template-emitter for fresh `src/collections/<slug>.ts`. String
  templating (not AST) since we control the entire shape; output
  mirrors the create-nexpress scaffold's collection style.
  Renders `relationTo` (string or array), `required`, `hasMany`,
  and Title-Cased label fallback.

  #### Runner — `run.ts`

  Full apply flow:
  1. Load theme module via dynamic import.
  2. AST-extract slug + fields from existing collections.
  3. Run `checkThemeRequirements` (real check, not stub).
  4. Plan steps + blockers.
  5. Print plan; abort on blockers; `--dry-run` exits here.
  6. Confirm interactively (skip with `--yes` or non-TTY).
  7. Apply steps (patch existing / write new).
  8. Best-effort spawn `pnpm db:generate` (then
     `pnpm exec drizzle-kit generate` as fallback).
  9. Print operator's next steps (`git diff`, `pnpm db:migrate`,
     activate in admin).

  ### Tests — 26 new

  **`extract-collection.test.ts`** (8): no-defineCollection
  returns null; missing slug returns null; leaf fields with
  relationship variants; row/collapsible recursion (matches
  runtime walker); array/group non-descent; computed-type fields
  skipped silently.

  **`patch-collection.test.ts`** (8): appends new field
  literals; idempotent skip on already-present; relationship
  field rendering; required: true rendering; partial
  idempotent (mix add + skip); recognizes nested fields (no
  double-add); throws CollectionPatchError on shape mismatch;
  no-op runs don't touch the file.

  **`generate-collection.test.ts`** (10): field literal shape
  variants; full file emit with import + export; camelCase
  export naming; Title-Case label fallback; trailing-s singular
  handling; zero-field collection.

  Total `@nexpress/cli` tests: 67 (was 41).

  ### Safety summary

  The apply phase honors every invariant the design doc §4.8
  calls out:
  - ✅ Never overwrites existing fields (add-only patcher)
  - ✅ Type conflicts → planner blockers → apply refuses
  - ✅ Dry-run mode (`--dry-run`)
  - ✅ All writes are FS-only — DB writes happen via the
    separate `pnpm db:migrate` step the operator runs
  - ✅ Idempotent re-runs

  ### What's not in this phase (deferred)
  - **`theme:uninstall`** — already recorded in design doc §10
    as a v0.3 candidate. Removing fields can drop data; needs
    a confirmation flow + backup story.
  - **Cross-theme migration** — operator switches from theme A
    to theme B; theme A's leftover fields stay until manual
    cleanup. Idempotent at install time; cleanup is v0.3.
  - **Interactive conflict resolution** — current contract is
    abort-on-conflict. A future phase could prompt to rename or
    preserve. Out of scope.
  - **Loading nexpress.config.ts directly** — F.8-B uses static
    AST extraction (skips operator code execution). A
    tsx-loader-based mode could catch dynamic field shapes; not
    in v0.2.

  ### Dependency note

  `@nexpress/cli` gains `ts-morph` (^25.0.1) for AST work. CLI
  bundle grows to ~60 KB (was ~50 KB).

- 2cf08cf: **Phase F.8-A — `nexpress theme:install` planner.**

  First half of the v0.2 theme contract's CLI installer (design
  doc §4.8). Adds the `theme:install` subcommand to the existing
  `@nexpress/cli` package — operators run
  `pnpm nexpress theme:install <pkg>` to preview what a theme
  expects from the site's collections before any file mutation
  lands.

  F.8 is split across two PRs because the apply phase carries
  the highest implementation risk in the v0.2 extension (AST
  patching live operator config files); keeping the planner's
  review separate buys the apply phase a focused review.

  ### What this ships
  - `nexpress theme:install <pkg>` — loads the theme module via
    `import(pkg)`, reads `manifest.requires`, walks
    `src/collections/*.ts` for existing slug names, and prints a
    human-readable plan (mirrors the design doc §4.8 example).
  - Pure planner (`planThemeInstall`) — the side-effect-free
    diff calculator. Takes manifest + existing slugs +
    pre-computed `checkThemeRequirements` result and emits an
    ordered list of `ThemeInstallStep`s plus blockers.
  - Plan formatter (`formatThemeInstallPlan`) — picocolors
    output with create-collection / patch-collection /
    warn-soft-mismatch / blocker sections.
  - Args wiring — `theme:install <pkg> [--dry-run] [--yes]`.
    Help text updated.

  ### What's NOT in this phase
  - **Field-level diff** — F.8-A discovers slug names only
    (regex over `src/collections/*.ts`). Loading full collection
    configs (which would surface field-level mismatches via
    `checkThemeRequirements`) requires tsx-based dynamic import
    and ships in F.8-B.
  - **AST patching** — F.8-A prints the plan and exits. F.8-B
    ships the ts-morph AST patcher that adds missing fields to
    existing `defineCollection` calls + the new-collection file
    generator + the drizzle-kit subprocess.
  - **Confirmation prompt** — current planner exits without
    prompting (the apply step is a stub today). Real prompt +
    apply lands in F.8-B.

  ### Tests

  7 new unit tests in `theme-install/plan.test.ts`:
  - isNoop when nothing to do
  - create-collection step for missing slug
  - patch-collection step for hard missing fields
  - warn-soft-mismatch step for soft fields
  - blockers list collects type conflicts
  - relationship conflict format
  - patch-collection skipped when collection itself is being created

  Total `@nexpress/cli` tests: 41 (was 34).

  ### Dependency note

  `@nexpress/cli` gains `@nexpress/core` (workspace) + picocolors
  deps. Core is needed for `NpThemeManifest` /
  `NpThemeRequirementResult` types only — we don't import any
  DB-touching modules from core, so the CLI bundle stays small.
  The `bin: nexpress` entry point is unchanged; existing scaffold
  already wires `@nexpress/cli` as a devDep (line 141 of
  `packages/cli/src/templates.ts`) so `pnpm nexpress
theme:install` works in scaffolded sites with no extra setup.

- 522b494: **F.8 — `nexpress theme:uninstall <package>`.**

  The inverse of `theme:install`. Reverses the AST changes the
  installer made: removes theme-contributed fields from the
  operator's collection files, and (with `--with-collections`)
  deletes whole collection files when their on-disk shape
  matches the theme's spec exactly.

  ### What it does

  | Step                                                              | Default                  | `--with-collections`                            |
  | ----------------------------------------------------------------- | ------------------------ | ----------------------------------------------- |
  | AST-remove fields the theme requires                              | yes                      | yes                                             |
  | Delete `src/collections/<slug>.ts` files matching theme spec      | no                       | yes (only when the file has no operator extras) |
  | Run `pnpm db:generate` so a DROP COLUMN migration is staged       | yes                      | yes                                             |
  | Run `pnpm db:migrate` (data-loss step)                            | **no — operator's call** | **no — operator's call**                        |
  | Run `pnpm remove <pkg>`                                           | no                       | no                                              |
  | Edit `themes:` array / collection imports in `nexpress.config.ts` | no                       | no                                              |

  The CLI never touches the database directly and never runs
  `pnpm remove`. Both are operator decisions: the migration
  contains DROP COLUMN statements that drop data, and the
  package can stay installed for a re-install round-trip.

  ### Safety
  - **Stateless plan, like install.** The planner reads the
    theme manifest's `requires` and the operator's current
    collections and proposes changes. It can't tell theme-
    contributed fields apart from operator-authored ones with
    the same name — so the plan is shown explicitly and confirmed.
  - **`--with-collections` is gated.** Whole-file deletion only
    runs when the on-disk fields match the theme's spec exactly.
    Operators who added their own fields to a theme-installed
    collection get `keep-collection-with-warning` instead, and
    only the theme-contributed fields come out.
  - **Idempotent.** Re-running on a partially-cleaned site
    reports `idempotent skip` and exits cleanly.
  - **Atomic per file.** AST-unpatch saves once at the end of
    each file; a thrown error before save leaves the file
    untouched.
  - **Non-TTY without `--yes` errors.** Mirrors install's
    guard against silent CI runs that "succeed" without
    applying.
  - **Clear destructive copy.** The plan output leads with a
    red "next migration will DROP COLUMN" warning so operators
    know what hitting `y` actually costs.

  ### CLI flags

  ```
  nexpress theme:uninstall <package>
  nexpress theme:uninstall <package> --dry-run            # print plan, exit
  nexpress theme:uninstall <package> --yes                # skip confirm
  nexpress theme:uninstall <package> --with-collections   # delete files too
  ```

  ### Tests

  15 new unit tests:
  - 8 in `theme-uninstall/plan.test.ts` covering noop / idempotent
    re-run / per-field removal / `--with-collections` (matches /
    extras / off) / theme-metadata pass-through
  - 7 in `theme-uninstall/ast/unpatch-collection.test.ts` covering
    single + multiple removal / idempotent / `row` + `collapsible`
    containers / throw on dynamic `fields` / no-save when nothing
    matched

  Total `@nexpress/cli` tests: 82 (was 67).

  ### Caveats
  - Theme package must still be installed when `theme:uninstall`
    runs (we read the manifest via dynamic import). Run
    `theme:uninstall` BEFORE `pnpm remove`. The CLI shows this
    hint when the import fails.
  - `nexpress.config.ts` is never touched. Operators remove the
    `themes:` array entry and the `import` lines manually after
    the CLI is done.

### Patch Changes

- 2c05fab: Self-review follow-ups for #502–#506.

  `@nexpress/cli` template `protected-layout.tsx` now passes
  `getRegisteredPatterns()` to `BlocksRegistryProvider`, mirroring
  `apps/web`. Without this, sites scaffolded after #503 silently
  missed plugin / theme contributed patterns in the page-builder's
  command-menu picker.
  - `DUPLICATE_MANY` no longer double-clones a descendant when both
    it and an ancestor are in the selection. The recursive walk
    emits a clone for every selected id, so the descendant was
    cloned once inside the ancestor's clone AND once on its own —
    4× the descendant, 2× the ancestor. Pre-filtering the selection
    to drop ids whose ancestor is also selected fixes the count.
  - Preview-iframe selection highlight survives `srcDoc` swaps. The
    iframe replaces its document on every preview refetch (every
    500ms-debounced edit), which discarded the injected `<style
data-np-preview-selection>`. Re-applying on `onLoad` keeps the
    highlight stable across debounced renders. Block-id is now
    `CSS.escape`-d before going into the attribute selector so an
    id with a quote / backslash can't break the selector.
  - Paste-pattern shape check recurses into `children`. A malformed
    deep node (e.g. `children` not an array, or a child missing
    `id`) used to pass the top-level guard and crash the reducer's
    `cloneBlockDeep` later. The dialog rejects the paste up front
    with a readable error instead.
  - Wrap-picker dismisses on outside-click and auto-closes when the
    selection stops being wrap-eligible. The render guard
    `{wrapPickerOpen && wrapEligible}` was hiding the popup
    visually but leaving `wrapPickerOpen` true — re-eligibility
    would then re-open the popup without the operator clicking.

- 9438363: **theme:install CLI cluster — closes #604, #605, #606.**

  Three correctness bugs in the `nexpress theme:install` apply
  phase, batched.

  **#606 — ENOENT when `src/collections/` is absent.** Projects
  without an existing collections directory hit
  `writeFileSync(.../missing-dir/posts.ts)` ENOENT on the first
  `theme:install`. Added `mkdirSync(dirname(target), {
recursive: true })` before the write so the bare-scaffold path
  succeeds.

  **#605 — created collection files were dead code.** The runner
  wrote `src/collections/<slug>.ts` but never touched
  `nexpress.config.ts`. The new file's `defineCollection()`
  export was unreferenced — bootstrap and schema generation only
  see collections listed in the config's `collections` array, so
  the install silently left the theme requirement unsatisfied.

  Fix: print a structured manual-step block after the apply
  phase, listing each newly-created collection's exact import
  line + array entry. The "Next" section also renumbers to call
  out the registration step. Marker-based AST editing of
  `nexpress.config.ts` (mirroring `nexpress plugin add`) is the
  cleaner long-term shape but adds ~100 LOC of new infrastructure
  that doesn't pay off until a plugin actually needs it — defer.
  The print-and-fail-loud path is what the issue's "Expected"
  section explicitly allows.

  **#604 — patch-collection targeted `<slug>.ts` instead of the
  discovered file path.** The planner extracted each collection's
  real `filePath` (so a collection authored at `blog-posts.ts`
  with `slug: "posts"` was correctly discovered), but the apply
  phase reconstructed `src/collections/${slug}.ts` and patched
  that — meaning operators with non-standard file names had a
  ghost `posts.ts` written instead of their `blog-posts.ts`
  getting the new fields.

  Fix: build a `slug → filePath` map from the discovered list
  and pass it into `applyPlan`. `patch-collection` steps prefer
  the discovered path; the legacy `<slug>.ts` fallback survives
  only for the defensive case where a `patch-collection` step
  references a slug discovery didn't surface (shouldn't happen,
  but mirrors the safer pattern already in `theme:uninstall`).

  No new tests — these are CLI runner paths that the existing
  `run.test.ts`-style integration suites don't cover (they
  test plan computation, not apply). Manual smoke is sufficient
  given the size; full e2e for theme:install is a follow-up.

  All 82 existing `@nexpress/cli` tests still pass. Repo
  typecheck + lint clean.

- 681c4b6: **theme:install generated collections gain safe slug defaults —
  closes #608.**

  `NpThemeFieldRequirement` describes per-field shape, but
  collection-level settings (`slugField`, `seo.urlPath`, access
  defaults) sit outside its surface. Reference themes silently
  depend on those: magazine's category archives query
  `categories.slug` and the sitemap emits `/category/<slug>`;
  docs's sidebar/templates link to `/docs/<slug>` and assume
  docs rows have `slug` values. Without a `slugField` config on
  the generated collection, new rows never got a `slug` — so
  those theme URLs 404'd indefinitely.

  Fix: `renderNewCollectionFile` (used by `theme:install` when
  creating absent collections) now emits **safe defaults** when
  the theme's requirement declares a `title: text` field:

  ```ts
  slugField: { useField: "title", unique: true },
  seo: {
    urlPath: (doc) => {
      const s = typeof doc.slug === "string" ? doc.slug : null;
      return s ? `/<slug>/${s}` : null;
    },
  },
  ```

  The presence of a `title` field is the signal that the theme
  expects the collection to be URL-addressable content. Themes
  without `title` (image gallery items, taxonomy chips,
  internal-only data) skip the defaults — the operator edits
  the generated file by hand if they want slug behavior.

  The emitted `urlPath` uses the collection slug as the URL
  prefix (`/docs/${s}` for the docs collection, `/posts/${s}`
  for posts). Themes that ship detail routes at different
  prefixes (portfolio uses `/work/:slug` for posts) should
  either:
  - Set the host's `posts.seo.urlPath` to match the theme's
    route convention.
  - Or document the conflict in the theme's install README.

  This is **option B** from issue #608's "Expected" section:
  "make the generated collection templates include safe defaults
  when the theme clearly depends on slugs/public URLs." The
  adjacent option A (extend `NpThemeCollectionRequirement` with
  optional `slugField` / `seoUrlPath` fields) stays deferred —
  the default-based approach covers the magazine/docs cases
  without adding new commitment surface. Add the optional fields
  when a real theme needs to override the defaults.

  5 new tests in `generate-collection.test.ts` covering: slug
  default emitted with title, urlPath shape, slug substitution
  in urlPath template, skip-when-no-title, skip-when-title-is-
  non-text. 87/87 in `@nexpress/cli`.

- Updated dependencies [5103c65]
- Updated dependencies [131be43]
- Updated dependencies [5203fd7]
- Updated dependencies [65da716]
- Updated dependencies [0c59b98]
- Updated dependencies [f778e80]
- Updated dependencies [89c32db]
- Updated dependencies [53627e1]
- Updated dependencies [98d3a4e]
- Updated dependencies [6657059]
- Updated dependencies [ae0c053]
- Updated dependencies [a107c8a]
- Updated dependencies [f98fe9c]
- Updated dependencies [d3ea817]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [2c31d26]
- Updated dependencies [1f8fbdf]
- Updated dependencies [463fe5f]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [ddbb536]
- Updated dependencies [41ac5d2]
- Updated dependencies [3eeac73]
  - @nexpress/core@1.0.0
