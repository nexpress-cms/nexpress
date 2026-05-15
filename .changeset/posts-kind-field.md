---
"@nexpress/core": patch
"@nexpress/app": patch
"@nexpress/theme": patch
---

feat(core, app, theme): universal-content-model Phase U.1 — `posts.kind` field + select-options union

First implementation phase of the universal-content-model track
(design lock: PR #748, design doc: `docs/design/universal-content-model.md`).
This phase introduces the data-model primitives. **Articles still
work exactly as today** — nothing visible changes until Phase U.2
when theme-docs declares `kind="doc"`.

## What lands

### Built-in `posts` collection (`@nexpress/app`)

  - New `kind` field: `select`, required, default `"article"`. One
    option shipped (`Article`); themes union additional kinds via
    `requires.collections.posts.fields.kind.options`.
  - New `parent` field: `relationship → posts` (nullable). Used by
    hierarchical kinds (docs, sections). Article-kind posts ignore it.
  - New `order` field: `number` (nullable). Sort order within a
    parent. Only meaningful for hierarchical kinds.

### Theme contract changes (`@nexpress/theme`)

  - `NpThemeSeedPost` gains optional `kind`, `parentSlug`, `order`,
    and `data` fields. `kind` defaults to `"article"`; theme seed
    data can declare `kind: "doc"` (etc.) once a theme registers
    that kind. `parentSlug` references a sibling seed row by slug
    — the seeder writes children in pass 1 and resolves parents
    in pass 2.
  - **`NpThemeSeedDocument` + `seedContent.documents` slot
    REMOVED.** Per design decision §10.5 (#748): zero theme
    consumers in-tree, no transition period. Themes that want to
    seed non-article kinds use `seedContent.posts` with `kind` set
    on each entry.

### Schema codegen + migration (`@nexpress/core`)

  - The generator now honors `field.defaultValue` for text /
    select / radio / textarea / email / number / checkbox columns
    — it previously dropped the value silently. Drizzle emits
    `DEFAULT '<value>'` in the migration, so adding a NOT NULL
    column to a table with existing rows succeeds without manual
    SQL fixups.
  - `apps/web/drizzle/0002_good_jack_murdock.sql` includes the
    Phase U.1 columns AND catches up accumulated post-#727 schema
    drift (portfolio's project fields, docs theme's lede /
    stable-since / badge). Run `pnpm db:generate && pnpm db:migrate`
    after pulling.

### Merge logic (`@nexpress/core`)

  - `merge-requirements.ts` gains select-options union semantics
    (design decision §10.3). When two themes contribute select
    options on the same field, options are deduped by `value` and
    last-wins on `label`. This is what lets theme-docs add
    `kind="doc"` to the shared `kind` select without colliding
    with the operator's `"article"` option.
  - `NpThemeFieldRequirement` gains an optional `options` field
    (select-only). Other field types ignore it; the same
    last-write-wins applies to non-select shapes via the existing
    name-collision path.

## What does NOT land in this phase

  - The kinds-metadata block (`requires.collections.<slug>.kinds`)
    that drives per-kind admin sidebar entries. Deferred to Phase
    U.2 where theme-docs declares `kind: "doc"` end-to-end so the
    sidebar logic ships alongside its first consumer.
  - `docs` collection migration. Still its own collection; Phase
    U.3 moves rows.

## Tests

  - `merge-requirements.test.ts` adds 3 unit tests covering the
    select-options union (additive, dedupe-by-value, refuse to
    union into a non-select field).
  - `@nexpress/core` 430 tests pass, `apps/web` 85, all themes
    build + typecheck clean.
