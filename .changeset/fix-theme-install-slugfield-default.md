---
"@nexpress/cli": patch
---

**theme:install generated collections gain safe slug defaults —
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
