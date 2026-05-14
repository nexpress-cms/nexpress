---
"@nexpress/editor": patch
"@nexpress/theme-docs": patch
---

`renderRichText` now auto-emits `id` attributes on h2/h3 headings,
and ships a matching `extractHeadingToc` helper.

Before this change the docs theme had its own ad-hoc slugify + walk
that produced a TOC list whose `#anchor` links never resolved —
the renderer didn't write any `id` onto the heading elements they
were supposed to land on. The fix is symmetric:

- **`@nexpress/editor`**: the rendered DOM now includes an
  auto-derived id on each h2 / h3. Slugs use a Unicode-aware
  walker (NFKD + `\p{M}` strip for diacritics, `\p{L}`/`\p{N}` for
  letters/digits so CJK headings survive) and dedupe collisions
  inside a single document — `Notes` / `Notes` / `Notes` becomes
  `notes`, `notes-2`, `notes-3`. Empty results (punctuation- or
  emoji-only headings) fall back to `section`. Numbering is per-
  call: two `renderRichText` calls on the same page don't share
  state. h1 / h4–h6 are intentionally left alone (h1 is the page
  title; h4+ is below typical TOC scope).
- **`@nexpress/editor/server`** also exports `extractHeadingToc`
  + `slugifyHeading` + the `NpHeadingTocEntry` type. The
  extractor returns one entry per h2 / h3 with the same id the
  renderer would emit, so deep-linking themes don't have to
  reimplement the slug logic and risk drift.
- **`@nexpress/theme-docs`**: the doc-page template's local
  `extractToc` + `slugify` are deleted; the template now calls
  the shared `extractHeadingToc`. The "On this page" rail now
  produces working anchor links out of the box.

Closes follow-up HIGH #1 from the theme redesign track.

Both new exports are part of the editor's experimental surface
(parented to `NpRichTextContent` which is already documented as
not-stable-pre-1.0). The slug shape will be honored as a patch-
level commitment going forward but may evolve before 1.0 if a
broader Lexical contract change forces it.
