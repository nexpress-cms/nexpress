---
"@nexpress/theme-magazine": minor
---

**Phase F.9-A — magazine theme rebuilt against v0.2 contract.**

First of three reference-theme rebuilds (design doc §4.9). The
magazine theme now exercises every v0.2 contract surface so we
can validate the contract end-to-end before declaring v0.2
done.

### Surface added (mapping to phases)

- **F.1 `manifest.requires`** — declares `posts` field
  expectations (`featured`, `coverImage`, `categories` rel,
  optional `author` rel) plus `categories` + `authors`
  collections (with `createIfAbsent`). Operators run
  `pnpm nexpress theme:install @nexpress/theme-magazine` to
  satisfy the requirements via F.8's CLI.
- **F.3 `manifest.settingsSchema`** — Zod schema with
  `heroStyle` (enum), `showAuthorByline` (boolean),
  `postsPerPage` (number), `accentColor` (hex regex), 
  `newsletterEnabled` (boolean), `socialLinks` (array of
  objects). Each field carries `.describe()` so the admin
  auto-form renders helpful labels.
- **F.4 `impl.blocks`** — two theme-shipped blocks:
  `magazine.hero-feature` (lead image + headline + CTA) and
  `magazine.section-strip` (3-column section breakdown).
  Bootstrap auto-stamps `source: "theme:magazine"`.
- **F.5 `impl.patterns`** — two patterns: 
  `magazine.homepage-feature-grid` (hero + section strip) and
  `magazine.editorial-cta` (related posts + CTA). Drop them
  via Cmd-K → "Pattern" group.
- **F.6 `impl.navLocations`** — three locations: `primary`
  (masthead), `footerSections`, `footerColophon`. Each with
  description + maxItems hint surfaced in the admin nav editor
  dropdown.
- **F.2 `impl.archives`** — `posts.byCategory` (`/category/:slug`)
  and `posts.byAuthor` (`/author/:id`). Each archive component
  fetches its own data via `findDocuments` (F.E hasMany filter
  makes `where: { categories: id }` work directly).
- **F.7 `impl.notFound`** — editorial 404 page styled to match
  magazine chrome.
- **F.7 `impl.seo.sitemapEntries`** — surfaces every category
  archive page in the sitemap (collection walk doesn't produce
  `/category/foo` URLs by itself).

### What's not in this PR — F.9.1 follow-up

- **More blocks**: newsletter inline form, image-quote, audio
  embed. Two representative blocks suffice to prove the
  contract; more is operator polish.
- **More archives**: `byTag`, `byDate`. Same shape as
  byCategory/byAuthor; one less for review focus.
- **Theme settings consumption**: theme components don't yet
  read `getThemeSettings()` — they render with hardcoded
  defaults. Wiring `settings.heroStyle` / `socialLinks` etc.
  through to the components is operator-facing polish; the
  contract is shipped, the operator can edit settings and the
  schema validates.

### Validation status

The first of three reference themes; F.9-B (docs) and F.9-C
(portfolio) follow with different contract-axis stress tests.
F.9-D retires `default` + `minimal` (absorbed as magazine
settings variants).

### Dependency note

`@nexpress/theme-magazine` gains `zod` (^4.3.6) for the
settings schema. Theme components stay server-rendered;
schema introspection happens server-side via core's
`introspectThemeSettingsSchema`.
