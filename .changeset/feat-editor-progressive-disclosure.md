---
"@nexpress/core": patch
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/theme-docs": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

feat(admin, core, themes): progressive disclosure in the document editor

The bundled-themes prebake stacks every theme's contributed
fields on `posts` — magazine, portfolio, docs all add columns
the operator may never need on a given post. The previous edit
view dumped them all into one "Publishing" sidebar Card,
forcing the operator to scroll through ~20 controls per post.

This redesign shapes the sidebar around what the operator is
actually authoring:

## Field grouping

- New `admin.group?: string` on `NpFieldBase` — sidebar fields
  with the same `group` label render together in their own
  collapsible-style Card. Default group = `"Publish"`.
- Group order in the rendered sidebar follows the first-seen
  order of fields in the collection's `fields` array, so
  operators control layout by ordering.

## Kind-aware conditional visibility

- `admin.condition` was already typed but unread; the edit view
  now honors it. The renderer subscribes to live form values
  via `form.watch()` and re-evaluates conditions on change.
- Built-in `posts` fields tagged:
  - `parent` / `order`: only when `kind === "doc"` (hierarchy)
  - `wpOriginalAuthor`: only when populated (no value → hidden)
- Theme-contributed fields tagged:
  - **theme-magazine** `featured`: hidden for `kind === "doc"`
  - **theme-portfolio** `heroImage`, `client`, `year`, `role`,
    `discipline`, `span`, `coverVariant`, `coverFigure`,
    `badge`: hidden for `kind === "doc"`, grouped under
    "Portfolio"
  - **theme-docs** `lede`, `stableSince`: only when
    `kind === "doc"`, grouped under "Docs"

## "Show all fields" escape hatch

- Sidebar header shows a toggle when at least one field is
  hidden by an active condition. Flipping it reveals every
  field including ones the kind filter is suppressing.
- Toggle state persists per-collection via `localStorage`.

## Theme requirement contract change

`NpThemeFieldRequirement` gains an optional `admin` block
forwarded onto the synthesised field's `admin` slot:

```ts
admin?: {
  group?: string;
  condition?: (data, siblingData) => boolean;
  position?: "main" | "sidebar";
}
```

Themes use these to bucket their contributed fields into
sidebar groups and gate visibility by kind.

## Schema drift cleanup

`apps/web/drizzle/0004_smart_valkyrie.sql` drops the orphan
`np_c_authors` table. The magazine theme stopped declaring
`requires.collections.authors` in #747 but the migration to
drop the leftover table was never generated. This PR's
schema:gen pass surfaced the drift; the auto-generated
migration cleans it up. No data loss (table never populated).

## What does NOT change

- Main column rendering is unchanged — title + body flow as
  before.
- 2-column layout preserved.
- No field-level data loss: hidden fields keep their stored
  values; `condition` is view-only.
- Theme swap behavior unchanged: switching themes doesn't
  remove fields from the schema, only hides irrelevant ones
  from the editor.

## Tests

- `core` 442/442
- `web` 85/85 (builtin-themes-union gate covers field-merge)
- All themes + admin + app build + typecheck clean
