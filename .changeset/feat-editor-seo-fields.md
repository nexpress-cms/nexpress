---
"@nexpress/app": patch
---

feat(app): per-doc SEO meta fields on built-in posts (3/7)

PR 3 of the editor progressive-disclosure sequence. Adds the
standard SEO meta fields every post editor expects, grouped in
a dedicated "SEO" sidebar Card.

## Fields

- `seoMetaTitle` (text) — overrides `<title>`; falls back to
  the post title.
- `seoMetaDescription` (textarea) — meta description / social
  card description; falls back to the post excerpt.
- `seoOgImage` (upload → media) — Open Graph / Twitter Card
  image; falls back to the cover image.

All three live in `admin.group: "SEO"` so they render together
in their own collapsible (per PR 2) Card.

## Why flat fields and not a `group` field type

`NpGroupField` has a known generator-vs-runtime inconsistency:
the type-generator emits nested `{ seo: { metaTitle } }` while
the drizzle column generator produces flat `seo_meta_title`
columns and the pipeline doesn't rehydrate the nesting on read.
Operators using a group field would see `post.seo.metaTitle` in
TypeScript but `undefined` at runtime.

Flat fields with `seo` prefix keep the contract honest: type
and runtime both produce `post.seoMetaTitle`. The framework gap
in `NpGroupField` is a separate concern (file as follow-up).

## Route update

`/blog/[slug]/page.tsx`'s `generateMetadata` previously cast
`post.seo` as a Record and reached for `.metaTitle` etc. — but
the SEO field never existed on the document, so the defensive
optional chain always returned undefined and every render
fell through to `post.title` / `post.excerpt`. Updated to read
the flat fields directly with explicit string-length guards.

## Migration

`apps/web/drizzle/0005_fat_fantastic_four.sql` adds three
nullable columns + the FK on `seo_og_image → np_media.id`. No
existing rows affected (all NULL by default).

## Test plan

- [x] `@nexpress/core` 442/442
- [x] `apps/web` 85/85
- [x] `@nexpress/app` build + typecheck clean
- [ ] Browser: edit a post → "SEO" group Card appears in sidebar
- [ ] Fill `seoMetaTitle` → view-source on public page shows it in `<title>`
- [ ] Leave fields blank → falls back to post title / excerpt / coverImage
