---
"@nexpress/core": patch
"@nexpress/app": patch
"@nexpress/admin": patch
"@nexpress/theme-docs": patch
---

feat(theme-docs, core, app, admin): universal-content-model Phase U.2+U.3+U.4 — docs collapse into posts.kind

Docs are now posts with `kind: "doc"`. Bundles U.2 (theme query
rewrite + admin sidebar per-kind), U.3 (drop docs table — no
data to migrate since pre-1.0 has no users), and U.4 cleanup
(remove docs slug from registry) into one PR. Pages stay
separate (the page-builder body is a different writing
experience from prose).

## Theme contract (@nexpress/core)

- `NpThemeCollectionRequirement.kinds` — keyed by discriminator
  value, each entry carries `label`, `labelPlural`, `icon`
  (lucide), optional `urlPattern`, optional `hierarchical`. The
  merge-requirements step unions across registered themes and
  stamps the result onto `admin.kinds` on the collection.
- `NpThemeCollectionKind` exported from both
  `@nexpress/core` root and via the requirement type.
- Merge logic now handles the `kinds` block (last-write-wins on
  per-kind props), in addition to the field-options union from
  U.1.

## Docs theme (@nexpress/theme-docs)

- `requires.collections.docs` removed. The collection is gone.
- `requires.collections.posts` now contributes `kind: "doc"`
  options, `lede` + `stableSince` fields, and
  `kinds.doc: { label, labelPlural: "Documentation",
  icon: "BookOpen", urlPattern: "/docs/:slug", hierarchical: true }`.
- `templates.docs.default` moves to `templates.posts.doc` —
  template id matches the kind value.
- Sidebar / doc-detail route / doc-page template queries all
  switch from `findDocuments("docs", ...)` →
  `findDocuments("posts", { where: { kind: "doc", ... } })`.

## Built-in posts (@nexpress/app)

- `seo.urlPath` reads `doc.kind` and returns `/docs/<slug>`
  when kind=doc, `/blog/<slug>` otherwise. Operators with
  custom kinds register their own override.

## Admin (@nexpress/admin)

- `AdminShellCollection.admin.kinds` — per-kind nav metadata.
  Sidebar walks the merged map and renders one entry per kind
  under the collection's group, linking to
  `/admin/collections/<slug>?kind=<value>`.
- Reference app's protected layout projects `c.admin.kinds`
  into the shell props.
- Collection list view (`/admin/collections/<slug>`) reads
  `?kind=` from searchParams and adds it to the `findDocuments`
  where clause. Unknown kinds yield empty results rather than
  errors.

## Schema

- `apps/web/drizzle/0003_tiresome_harry_osborn.sql`:
  `DROP TABLE np_c_docs CASCADE` + ADD COLUMN lede + ADD COLUMN
  stable_since on np_c_posts.
- Pre-1.0 + no users → destructive drop is OK. Operators with
  doc data run U.1 first to add `kind` to posts, then export
  np_c_docs rows to `kind="doc"` posts manually before
  upgrading to this release.

## Open follow-ups (deliberately deferred)

- **Create-form kind pre-fill** — clicking "New doc" from
  `/admin/collections/posts?kind=doc` should pre-set the kind
  field to "doc". Today the operator picks it manually.
- **Generic kind URL resolver** — `seo.urlPath` hardcodes the
  `doc` branch. A reads-from-`admin.kinds.<x>.urlPattern`
  helper would generalise; not needed until a third kind lands.
- **Kind-aware capabilities** — `content.publish.<kind>`
  capability strings designed-in but not implemented. Add when
  an operator asks for the split.
