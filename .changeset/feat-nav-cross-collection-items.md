---
"@nexpress/core": minor
"@nexpress/admin": minor
"@nexpress/web": minor
"create-nexpress": patch
---

The page-edit "In navigation" panel now works for any
page-shaped collection, not just the reference `pages`
collection. Adding a doc from a `landing-pages` or
`static-pages` collection produces a nav item that resolves to
the doc's correct public URL — previously, the URL resolver
was hardcoded to look up doc ids in the `pages` collection,
silently returning `#` when the panel was opted into elsewhere.

How it works:

- `NpNavItem` gains an optional `collectionSlug` field. When
  set on a `type: "page"` item, the URL resolver looks the doc
  up in that collection instead of `pages`.
- The resolver now drives URLs through each collection's
  `seo.urlPath` (the same contract the sitemap and RSS feed
  use), so the per-collection URL convention is honored
  automatically. The reference `pages` collection's existing
  `seo.urlPath` produces the same URLs it always did — fully
  back-compat.
- The `NavMembershipPanel` accepts a `collectionSlug` prop
  (defaults to `"pages"`), passes it through to the membership
  endpoint as `?collection=<slug>`, and stamps it on new nav
  items only when it differs from `"pages"` so the wire format
  for the common case stays minimal.
- The `create-nexpress` page template gains an explicit
  `seo.urlPath` definition. This was previously implicit — the
  resolver hard-coded the same logic as a fallback — but with
  the resolver now generic, the template needs to declare its
  own URL contract. Sitemap support comes along for free.
