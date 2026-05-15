# Universal Content Model — Design Plan

> Version: draft 1
> Date: 2026-05-15
> Status: design draft — implementation hasn't started.
> Prerequisites:
>   - Collection authoring contract
>     (`packages/core/src/config/define-collection.ts`)
>   - Theme `requires.collections` (`packages/theme/src/types.ts`)
>   - Bundled-themes prebake path
>     (`packages/core/src/themes/merge-requirements.ts`)
>   - `@nexpress/app` built-in `posts` collection
>     (`packages/app/src/collections/posts.ts`)

---

## 0. Position statement

Today the framework ships and themes contribute multiple prose
content collections that do the same job under different names:

| Collection | Origin | Body type | Real purpose |
|---|---|---|---|
| `posts` | Built-in (`@nexpress/app`) | `richText` | Articles |
| `docs` | `theme-docs` requires | `richText` | Documentation entries |
| `pages` | Built-in (`@nexpress/app`) | `blocks` | Page-builder marketing pages |
| `authors` | `theme-magazine` requires (RETIRED #747) | — | Bylines — already collapsed into `np_users` |

The bundled-themes prebake materialises all four themes'
`requires.collections` even when only one theme is active. An
operator running the default theme on a magazine-bundled
scaffold still gets `np_c_docs` in their database.

Plugins can NOT add collections at runtime in v1 — collections
need codegen + migrate, and plugins are "npm-package + rebuild".
That means the "content surface" is effectively closed at
scaffold + theme-install time. The case for multiple parallel
collections (one per content shape) presupposed a world where
plugin authors freely add their own — but that's not the world
v1 ships.

**This document proposes:** collapse prose-bodied collections
(`posts` + `docs`) into a single `posts` collection
discriminated by a `kind` field. Keep `pages` separate — the
page-builder editor is a fundamentally different writing
experience and the navigation editor / page templates surface
already speaks `pages`-specific.

`authors` is already gone (PR #747 — folded into `np_users`).
This doc covers the bigger move: `docs` → `posts.kind = "doc"`.

---

## 1. Goals

- **One prose-content collection** (`posts`) with a `kind`
  discriminator for content-type semantics (article / doc /
  project case study / whatever a theme needs).
- **Per-kind admin sub-navigation** so operators see "Articles"
  and "Docs" as distinct sidebar entries even though they live
  in the same physical collection.
- **Per-kind URL patterns** so `/posts/<slug>` and
  `/docs/<slug>` both still resolve correctly through one
  collection.
- **Per-kind capability checks** so a future
  `content.publish.doc` role can co-exist with
  `content.publish.article` without role-table inflation.
- **No new plumbing for `pages`** — it stays its own collection
  with its block-builder editor. Folding pages is a separate
  follow-up if it ever happens.

## 2. Non-goals

- Folding `pages` into the universal `posts` collection. The
  block-vs-richtext body split is the natural fault line; we're
  not crossing it.
- Runtime-pluggable collections (the v2-grade question of
  "plugins add tables"). The universal-posts approach is
  *aligned* with that future but doesn't depend on it.
- Touching `categories` / `tags` — they're taxonomies, not
  content. They stay as-is.
- Renaming the `posts` collection to `content` or anything else.
  The collection slug stays. The new `kind` field is what gives
  operators per-type semantics.

---

## 3. Proposed shape

### 3.1 New `kind` field on `posts`

```ts
// packages/app/src/collections/posts.ts (built-in)
defineCollection({
  slug: "posts",
  fields: [
    {
      type: "select",
      name: "kind",
      required: true,
      defaultValue: "article",
      options: [
        { label: "Article", value: "article" },
        // Themes can extend this via `requires.collections.posts.fields.kind`
        // (the registry's union-merge picks up extra options).
      ],
      admin: { position: "sidebar" },
    },
    // existing fields — title, body, slug, publishedAt, status, author, ...
    {
      type: "relationship",
      name: "parent",
      relationTo: "posts",
      hard: false,
      admin: { description: "Parent post — used by hierarchical kinds (e.g. docs)" },
    },
    { type: "number", name: "order", admin: { description: "Sort order within parent (hierarchical kinds)" } },
  ],
});
```

`parent` + `order` move from `docs` to `posts` as optional
fields. Article-kind posts ignore them.

### 3.2 Theme contributes a kind

```ts
// packages/themes/docs/src/index.ts
defineTheme({
  manifest: {
    requires: {
      collections: {
        posts: {
          fields: {
            // Adds "doc" to the kind enum. Framework union-merges
            // theme-contributed select options.
            kind: { type: "select", options: [{ value: "doc", label: "Doc" }] },
            lede: { type: "textarea", hard: false },
            stableSince: { type: "text", hard: false },
            badge: { type: "text", hard: false },
          },
        },
      },
    },
  },
});
```

The `docs` collection definition goes away entirely from
docs-theme. Docs-shaped fields (`lede`, `stableSince`, `badge`)
land on `posts` and are no-ops for articles.

**Open issue (3.2.a):** field merge today doesn't union-merge
`select.options`. It replaces. We need to change the merge
contract so that operator-declared options stay, theme-contributed
options *add*. Detail in §6.

### 3.3 Per-kind metadata declaration

Themes need to tell the admin "your `kind=doc` posts get a
sidebar entry labeled 'Docs' and a `/docs/<slug>` URL." A new
optional `kinds` block on the theme contract:

```ts
defineTheme({
  manifest: {
    requires: {
      collections: {
        posts: {
          fields: { kind: { ... }, lede: { ... }, ... },
          kinds: {
            doc: {
              label: "Docs",
              labelPlural: "Documentation",
              icon: "book",                    // lucide-react name
              urlPattern: "/docs/:slug",       // public-site URL
              adminUrlPattern: "/admin/collections/posts?kind=doc", // sidebar destination
              hierarchical: true,              // hints admin to surface parent/order
            },
          },
        },
      },
    },
  },
});
```

The admin shell reads union-merged `kinds` metadata across all
registered themes (same path as `requires.collections.fields`)
and renders a sidebar entry per kind under "Content".

### 3.4 Admin UX changes

**Before:**
```
Content
├── Posts        (/admin/collections/posts)
├── Docs         (/admin/collections/docs)
├── Pages        (/admin/collections/pages)
├── Categories
└── Tags
```

**After:**
```
Content
├── Articles     (/admin/collections/posts?kind=article)
├── Docs         (/admin/collections/posts?kind=doc)
├── Pages        (/admin/collections/pages)     # untouched
├── Categories
└── Tags
```

Each "kind entry" is a query-string preset over the same
underlying admin list view. The list view auto-filters
`where: { kind: "<active>" }`, the "New" CTA pre-fills
`kind: "<active>"`, and field visibility narrows to fields
relevant to that kind (e.g. `parent` / `order` show only when
the active kind has `hierarchical: true`).

The "All content" catch-all (no kind filter) is also reachable
at `/admin/collections/posts` so an operator can still see
everything in one table when they need to.

### 3.5 Public URL routing

The catch-all router (`apps/web/src/app/(site)/[[...slug]]/page.tsx`)
already does:

1. Page-slug lookup
2. Slug-redirect lookup
3. Theme route match
4. Plugin route match
5. 404

Per-kind URL patterns slot between step 3 and step 4: the
catch-all dispatcher walks the union of theme-declared `kinds.*.urlPattern`
entries and matches the request path. A `urlPattern: "/docs/:slug"`
match resolves to a `posts` query with `where: { kind: "doc", slug: "<param>" }`.

Themes that declare a kind without a `urlPattern` get the
default `/posts/<slug>` URL — same as articles today.

### 3.6 Theme query shape

```ts
// theme-docs sidebar
findDocuments<DocsRow>("posts", {
  where: { kind: "doc", status: "published" },
  sort: "order",
});

// theme-magazine index
findDocuments<ArticleRow>("posts", {
  where: { kind: "article", status: "published", featured: true },
});
```

All theme queries gain a `where: { kind: "<x>" }` filter. The
sitemap generator does the same — one `posts` query per kind,
each generating per-kind URL patterns.

---

## 4. Capability model

Today: `content.author`, `content.publish` cover all collections.

Future-compatible kind-aware capabilities (NOT implemented in
the first cut — listed here for design-time clarity):

- `content.publish` — catch-all (today's behavior, keeps working)
- `content.publish.article` — only article-kind posts
- `content.publish.doc` — only doc-kind posts
- `content.author` (similar split)

The `can(user, capability, { collection, kind })` signature is
forward-compatible: today `kind` is ignored, future versions
narrow on it. No breaking change for v0.x.

**First-cut decision:** ship the universal-posts collapse with
the existing un-narrowed capabilities. Add per-kind capabilities
only when an operator actually asks for the split.

---

## 5. Migration plan

### 5.1 Data migration (drizzle)

A migration moves `np_c_docs` rows into `np_c_posts`:

```sql
INSERT INTO np_c_posts (id, site_id, title, body, slug, status, parent, "order", kind, ...)
SELECT id, site_id, title, body, slug, status, parent, "order", 'doc', ...
FROM np_c_docs;

DROP TABLE np_c_docs;
```

**Slug collisions** are the big risk: a site that had `slug=intro`
in both posts (article) and docs would hit a unique-key violation.
Mitigation: drop the `slug` unique constraint, add
`UNIQUE(slug, kind)` instead. Theme routes already query by
`(slug, kind)` so URLs stay deterministic.

**Search vector** rebuilds per migrated row.

**Slug history** entries (`np_slug_history`) get their
`collection` column rewritten from `docs` to `posts` and gain a
`kind = "doc"` discriminator so the redirect resolver knows
which kind to look up.

### 5.2 Theme code migration

Theme-docs:
- `findDocuments("docs", ...)` → `findDocuments("posts", { where: { kind: "doc", ... } })`
- Sidebar / TOC / detail / search route changes follow the same pattern
- Type imports: `DocsDocument` → `PostsDocument` (the generated
  TS type now has `kind` field)

### 5.3 Plugin code migration

Plugins that referenced the `docs` collection (none in-tree
today) would need to bump to the kind-filtered query. Listed
here only as a public-surface migration note.

### 5.4 Generated `apps/web/src/db/generated/collections.ts`

Regenerates automatically via `pnpm schema:gen`. The
docs-theme's contributed fields land on `posts`, not on a
separate `docs` table. After migration:

```ts
// Before
export const postsTable = pgTable("np_c_posts", { /* article fields */ });
export const docsTable = pgTable("np_c_docs", { /* doc fields */ });

// After
export const postsTable = pgTable("np_c_posts", {
  /* article fields + lede + stableSince + badge + parent + order + kind */
});
// docsTable: gone
```

### 5.5 SetupWizard `documents` seed slot (#739)

The `documents?: Record<slug, NpThemeSeedDocument[]>` slot
introduced for theme-contributed seed data was designed assuming
arbitrary new collections (docs, projects, products). After the
universal collapse, it becomes "posts seed with kind set":

```ts
// Old (#739)
seedContent: {
  documents: {
    docs: [{ data: { title: "...", body: ... } }, ...],
  },
}

// New
seedContent: {
  posts: [
    { kind: "doc", data: { title: "...", body: ... } },
    { kind: "article", data: { ... } },
  ],
}
```

The `documents` slot stays in the contract as a deprecated
alias (operators with `documents.docs = [...]` still get those
rows seeded as `kind="doc"` posts), removed in a future minor.

---

## 6. Field-merge changes (3.2.a)

Today the merge in `merge-requirements.ts` last-wins on field
config. For `select.options` we need union semantics:

```ts
// Before
mergeField(operator: NpFieldConfig, themeContrib: NpFieldConfig): NpFieldConfig {
  return { ...operator, ...themeContrib };  // last write wins
}

// After
mergeField(operator, themeContrib) {
  if (operator.type === "select" && themeContrib.type === "select") {
    return {
      ...operator,
      ...themeContrib,
      options: dedupeByValue([...operator.options, ...themeContrib.options]),
    };
  }
  return { ...operator, ...themeContrib };
}
```

Edge case: two themes declare overlapping option values (e.g.
both contribute `kind: "doc"`). Today's same-field-two-themes
gate test in `apps/web/tests/builtin-themes-union.unit.test.ts`
catches this — we'd need a similar gate for same-option-two-themes
inside select union, OR allow it (last-wins on the label).
**Recommendation:** allow it (last-wins on label, dedupe on
value). Less ceremony, low real-world risk.

---

## 7. Implementation phases

### Phase U.1 — Schema + admin foundation

PRs in order:

1. **`kind` field on built-in posts.** Defaults to `"article"`
   for back-compat. No theme-side changes; existing sites
   migrate cleanly (everything is `kind=article`). Generated
   schema regenerates. Drizzle migration adds NOT NULL column
   with default.
2. **`parent` + `order` on built-in posts.** Optional fields.
   Article posts ignore them; the docs-kind migration later
   relies on them.
3. **Field-merge select-options union.** `merge-requirements.ts`
   change + unit test. Standalone — useful even before kind
   discriminators land.
4. **Admin sidebar per-kind entries.** Reads union-merged
   `requires.collections.posts.kinds` metadata, renders sidebar
   under "Content". Single-kind sites see no change (just the
   default "Articles" entry).

After Phase U.1, articles still work exactly as today. Nothing
visible changes unless a theme declares a kind.

### Phase U.2 — Docs theme migration

5. **theme-docs declares `kind: "doc"` and contributes
   docs-specific fields** (lede, stableSince, badge) to
   `posts`. Drops `requires.collections.docs` entirely.
6. **Docs theme queries rewrite** —
   `findDocuments("docs", ...)` → `findDocuments("posts", { where: { kind: "doc", ... } })`
   across sidebar, search, detail, TOC, prev/next.
7. **Per-kind URL routing** in the catch-all dispatcher —
   `/docs/:slug` matches `kinds.doc.urlPattern`.
8. **Slug-history kind awareness** — `np_slug_history.kind` column.

### Phase U.3 — Data migration

9. **Drizzle migration** moves `np_c_docs` rows to `np_c_posts`
   with `kind="doc"`. Slug uniqueness moves to
   `UNIQUE(slug, kind)`. Slug history rewrites `collection`
   column.

After Phase U.3, sites that activated docs theme see their
docs in `/admin/collections/posts?kind=doc`. `/docs/<slug>`
URLs keep resolving.

### Phase U.4 — Cleanup

10. **#739 `documents` seed slot** becomes a deprecated alias
    for `seedContent.posts.kind`.
11. **`docs` collection slug** removed from the registry's
    "known slugs" — operator-declared `docs` collections
    (third-party) still work; the framework just stops
    materialising one automatically.

---

## 8. Risks & open questions

### 8.1 Existing site upgrade path

Sites with magazine + docs themes active and docs content:
- Migration runs. `np_c_docs` rows move. URLs keep working.
- If two existing rows have the same slug (one in `np_c_docs`,
  one in `np_c_posts`), the migration aborts with a clear error
  pointing the operator at the conflicting slugs.

### 8.2 Search / sitemap / RSS

These walk "every published collection" today. They become
"walk posts, group by kind". The per-kind URL pattern lookup
handles canonical URLs. No regression but every callsite needs
updating.

### 8.3 Capability granularity

The first cut keeps `content.publish` as a catch-all. If an
operator-facing role split surfaces (e.g. "doc writer who
shouldn't publish blog articles"), the kind-aware capability
strings already specified above slot in additively.

### 8.4 Theme that wants a kind WITHOUT a URL pattern

E.g. "internal-only kind for staff notes." Theme declares
`kinds.note` with no `urlPattern`. The catch-all dispatcher
falls back to "no URL" — `/posts/<slug>` returns 404 for that
kind. The admin still shows the sidebar entry; backend queries
still work; the public web just can't reach it. Reasonable
default.

### 8.5 What if `pages` should also fold someday?

Out of scope for this doc. If we ever fold pages, the design
becomes "two universal collections: `posts` (rich-text body)
and `pages` (block body)", and `kind` extends to both
collections. The schema migration would mirror Phase U.3 with
the source table being `np_c_pages` and the body field being
`blocks` instead of `richText`.

### 8.6 Third-party plugin authors who shipped a `docs` route

None in-tree today. If they appear after migration, they need
to switch `findDocuments("docs", ...)` to the kind-filtered
posts query. Listed in the v0.4 changelog as a migration note.

### 8.7 Backwards-compat shim

We could keep a `docs` slug alias that proxies to `posts where kind="doc"`.
**Recommendation:** don't. The migration is one-time, the
benefit is operator-facing (sidebar) and breaks loud (any code
referencing the old slug fails fast). Pre-1.0 we can move.

---

## 9. What this doc does NOT decide

- The exact admin sidebar component changes (left to
  implementation — the contract is "render entries from
  `kinds.*` metadata").
- Whether to ship per-kind icons in the sidebar (yes, but
  source TBD — lucide-react name strings vs registered icon
  components).
- The full select-options merge semantics for non-`select`
  field types. Today this doc covers select only; other unions
  (e.g. `relationship` `relationTo`) stay last-wins.

---

## 10. Decision checkpoints

These need explicit sign-off before code lands:

1. **Bundle the universal collapse as one PR per phase
   (U.1–U.4) vs one giant PR.** Recommend per-phase — each is
   independently revertable.
2. **Default `kind` value: `"article"` vs `null` vs no default.**
   Recommend `"article"` — every existing post gets it via
   migration default, no manual backfill.
3. **Field-merge select-options union** — confirm the union
   semantics in §6. Last-wins on label, dedupe on value.
4. **Per-kind URL: theme contributes the pattern vs framework
   reads `posts.slug` only.** Recommend theme-contributed — the
   `/docs/<slug>` pattern is a docs-theme concern, not a
   framework one. Themes that don't declare a pattern get
   `/posts/<slug>` automatically.
5. **`documents` seed slot deprecation timeline.** Recommend
   keep through v0.4 as deprecated alias, remove in v0.5.

---

## 11. Closeout

When all phases (U.1–U.4) ship, retire this doc by adding a
"Status: shipped — see PRs ..." line at the top. The
implementation notes here can move into `theme-authoring.md`
("how to declare a kind") and CLAUDE.md / AGENTS.md ("STABILITY"
gets a new entry for `posts.kind` + `kinds` metadata).
