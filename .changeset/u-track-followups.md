---
"@nexpress/admin": patch
"@nexpress/app": patch
---

feat(admin, app): universal-content-model follow-ups — create-form kind pre-fill, generic URL resolver, kind-aware template lookup

Three trivial follow-ups carved out during the U track
self-reviews. None are blocking; each removes a small wart
exposed when the framework grew per-kind awareness.

## 1. Create-form `?kind=` pre-fill

`CollectionListView` now threads `?kind=<value>` onto the
Create CTA when the list view is kind-scoped. The matching
create page reads `?kind=` from `searchParams` and passes
`{ kind }` as the initial doc, so the new-doc form opens with
the kind field already set to what the operator was filtering.
Empty / absent kind → bare `/create` URL (field's
`defaultValue` applies, same as before).

## 2. Generic kind URL resolver in built-in posts

`seo.urlPath` previously hardcoded `kind === "doc"` →
`/docs/<slug>`. Replaced with a registry read:
`getCollectionConfig("posts").admin.kinds.<kind>.urlPattern`
substitutes `:slug` and returns the result. Unknown kinds (or
kinds without a `urlPattern` declared) fall back to the
framework default `/blog/<slug>`.

This means a theme that contributes a third kind (e.g.
portfolio's hypothetical `kind: "project"` with `urlPattern:
"/work/:slug"`) gets correct sitemap / canonical / slug-history
URLs without needing to override the built-in collection.

`try / catch` around the registry read covers the
not-yet-loaded boot path (seed scripts that run urlPath
resolution before `loadCollections` completes).

## 3. Kind-aware template lookup in `/blog/<slug>`

`resolvePostDetailTemplate` previously walked
`explicitTemplateId / "detail" / "default" / "feature"`. The
new walk prepends `post.kind` between the explicit id and the
legacy triple — so a theme that registers
`templates.posts.<kind>` gets picked up automatically by the
framework's blog route.

Today the `/blog/<slug>` guard 404s any `post.kind !==
"article"` (the doc-kind canonical URL is `/docs/<slug>` via
the theme route), so the new candidate is only exercised when
a theme registers `templates.posts.article` for non-default
article rendering. A future theme that contributes a kind AND
wants to ride `/blog/<slug>` (e.g. seasonal post types) can
register `templates.posts.<kind>` without needing its own
theme route.

## Tests

- `@nexpress/core` 441/441, `apps/web` 85/85 (no test additions
  — these are wire-up changes that flow through existing test
  coverage)
- All themes + admin + app typecheck clean
