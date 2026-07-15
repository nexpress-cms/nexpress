# SEO runtime contracts

NexPress exposes one canonical SEO contract from `@nexpress/core/seo`. Page
metadata, JSON-LD, sitemap entries, sitemap-index entries, Atom entries, and
theme-owned `robots.txt` bodies all cross this boundary before they reach a
renderer or a cache.

The contract is deliberately fail-closed. TypeScript types help authors while
they write code; the runtime validators protect JavaScript consumers, theme
callbacks, collection URL resolvers, persisted dates, and external adapters
that can still return malformed values.

## Imports

```ts
import {
  NpSeoContractError,
  npDefineFeedEntries,
  npDefineSitemapEntries,
  npRequireFeedEntries,
  npRequireSitemapEntries,
  renderSitemapXml,
} from "@nexpress/core/seo";
import type { NpFeedEntry, NpSitemapEntry } from "@nexpress/core/seo";
```

Custom Next pages should continue importing `buildPageMetadata` from
`@nexpress/next`; that wrapper returns Next's `Metadata` type while delegating
to the same Core validator.

## Enforcement points

| Boundary                                         | Validation time                                                         | Failure behavior                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `buildPageMetadata()`                            | Before settings are read                                                | Throws `NpSeoContractError`                         |
| JSON-LD builders                                 | Before output is composed                                               | Throws `NpSeoContractError`                         |
| `buildSitemap()`                                 | Options first; every `seo.urlPath()` result and final catalog afterward | Throws; malformed paths are never skipped or cached |
| `renderSitemapXml()` / `renderSitemapIndexXml()` | Before XML rendering                                                    | Throws; no partial XML is emitted                   |
| `buildAtomFeed()` / `renderAtomFeed()`           | Options and extra entries first; final catalog afterward                | Throws; malformed entries are never cached          |
| Theme `sitemapEntries` / `feedEntries`           | Immediately after the callback resolves                                 | Throws before framework merge/render/cache          |
| Theme `robotsTxt`                                | Immediately after the callback resolves                                 | Throws before `Response` construction               |
| Framework `robots.txt`                           | After origin/body composition                                           | Throws before `Response` construction               |
| `/feed.xml?collection=`                          | Before feed dispatch                                                    | Invalid collection slugs return HTTP 400            |

Theme definitions still validate the presence and function shape of SEO hooks
when `defineTheme()` evaluates. Return values cannot exist until a hook runs,
so result validation happens at that first dispatch boundary.

## Sitemap entries

Sitemap locations and alternate `href` values are root-relative URLs. They may
include a query string, but cannot contain fragments, credentials, whitespace,
backslashes, dot segments, invalid percent escapes, or protocol-relative
paths. Absolute locations are intentionally rejected because the renderer
owns the site origin.

```ts
const marketingRoutes = npDefineSitemapEntries([
  {
    loc: "/campaigns/summer",
    lastmod: "2026-07-15T00:00:00.000Z",
    changefreq: "weekly",
    priority: 0.7,
    alternates: [
      { hreflang: "en", href: "/en/campaigns/summer" },
      { hreflang: "ko", href: "/ko/campaigns/summer" },
    ],
  },
]);
```

Rules:

- at most 50,000 entries, matching the sitemap protocol limit;
- at most 52,428,800 UTF-8 bytes after XML rendering;
- unique `loc` values per catalog;
- canonical ISO 8601 timestamps from `Date#toISOString()`;
- finite priorities from `0` through `1`;
- at most 100 alternates with unique canonical BCP 47 `hreflang` values
  (`x-default` is also accepted);
- exact objects and dense arrays only; unknown fields, accessors, symbols,
  custom array properties, and revoked proxies are rejected.

`buildSitemap({ perCollectionLimit, collections, locale })` validates its
options too. Collection lists contain at most 200 unique lowercase slugs,
`perCollectionLimit` is an integer from 1 through 50,000, and `locale` is a
canonical BCP 47 tag.

## Atom feed entries

```ts
const extras = npDefineFeedEntries([
  {
    id: "https://example.com/releases/v1",
    title: "Version 1",
    summary: "Release notes and migration guidance.",
    link: "https://example.com/releases/v1",
    author: "NexPress",
    updated: "2026-07-15T00:00:00.000Z",
    published: "2026-07-15T00:00:00.000Z",
  },
]);
```

Feed ids and links are bounded absolute HTTP(S) URLs without credentials,
fragments, unsafe escapes, or dot segments. Required nullable fields must be
present as either valid text/timestamps or `null`; `undefined` is not a wire
value. Catalogs contain at most 500 entries with unique ids. Framework entries
win when a valid theme extra uses the same id, preserving the established
merge policy.

## Page metadata and JSON-LD

`buildPageMetadata()` accepts an exact object. Titles, descriptions, canonical
paths, images, Open Graph types, dates, and locales are bounded and validated
before site settings are read. Page paths stay root-relative; images may be a
root-relative path or an absolute HTTP(S) URL. Article dates must be valid
`Date` instances.

JSON-LD article and person URLs are absolute HTTP(S) URLs. Optional images may
also be root-relative. String dates must already equal `Date#toISOString()`;
`"2026-07-15"` is not silently reinterpreted as midnight. An explicit
`BuildJsonLdContext.origin` is a canonical origin such as
`https://example.com`, never a URL with a path or trailing slash.

## Theme SEO hooks

```ts
import { defineTheme } from "@nexpress/theme";
import type { NpSitemapEntry } from "@nexpress/core/seo";

export const theme = defineTheme({
  manifest: {/* ... */},
  impl: {
    seo: {
      sitemapEntries: async (): Promise<readonly NpSitemapEntry[]> => [
        { loc: "/archive", changefreq: "daily" },
      ],
      robotsTxt: () => "User-agent: *\nDisallow: /preview\n",
    },
  },
});
```

`@nexpress/theme` uses and re-exports Core's canonical `NpSitemapEntry`,
`NpSitemapAlternate`, and `NpFeedEntry` types. Do not maintain a structural
copy inside a theme package. Callback results are cloned and frozen after
validation, so mutate source data before returning rather than after dispatch.

`robotsTxt` may be empty and preserves line endings, but is limited to 500,000
safe Unicode characters. NUL, unsafe control code points, malformed Unicode,
objects, and oversized bodies fail explicitly.

## Diagnosing failures

`NpSeoContractError.issues` is a frozen list of `{ code, path, message }`
records. The exception message includes the first exact path, for example:

```text
Invalid sitemap entries: sitemapEntries.0.loc: SEO paths must be safe root-relative URLs ...
```

Fix the producing collection resolver or theme callback. Do not catch the
error and serve a partially valid sitemap/feed: a cached partial crawler
surface is harder to detect and repair than an explicit failed request.
