---
"@nexpress/cli": minor
---

**Phase F.8-B — `nexpress theme:install` apply phase.**

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
