# Search runtime and adapter contract

NexPress search uses one server-only contract from Core input through an
external adapter or the built-in Postgres path, the public API, Next data
cache, themes, reindexing, and live health diagnostics. Import it from the
domain subpath:

```ts
import {
  searchCollections,
  type NpSearchRequestInput,
  type NpSearchResult,
} from "@nexpress/core/search";
```

## Request contract

`searchCollections()` accepts an exact `NpSearchRequestInput`. Unknown keys,
non-canonical collection slugs/locales/site ids, duplicate collections, unsafe
integers, and over-bound values throw `NpSearchContractError` before dispatch.

| Field         | Contract                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| `q`           | Required text; NFKC-normalized, trimmed, whitespace-collapsed, max 256.  |
| `collections` | Optional 1–200 unique canonical slugs. Omit to use all searchable ones.  |
| `limit`       | Safe integer `1..50`; default `10`.                                      |
| `offset`      | Safe integer `0..10000`; default `0`.                                    |
| `locale`      | Optional canonical BCP 47 locale that must be configured by the project. |
| `siteId`      | Optional canonical site id; defaults to current site, then `default`.    |
| `visibility`  | `public` (default) or trusted server-only `all`.                         |

The candidate-row budget is 50,000:
`(offset + limit) × selected searchable collections`. This stops a deep page
across many collections before it fans out into expensive queries.

The public `GET /api/search` surface always uses the current site and
`visibility: "public"`. It requires one `q` parameter, rejects unknown or
duplicate query parameters, treats `page` and `offset` as mutually exclusive,
and returns 400 for unknown collections or unconfigured locales. Its OpenAPI
operation describes the same bounds and complete response envelope.

## Result contract

Every successful path returns all of these fields:

```ts
interface NpSearchResult {
  results: readonly NpSearchResultItem[];
  total: number;
  perCollection: Readonly<Record<string, number>>;
  facets: readonly NpSearchCollectionFacet[];
  limit: number;
  offset: number;
  hasNextPage: boolean;
}
```

Core derives `facets`, `limit`, `offset`, and `hasNextPage`; adapters cannot
override them. Documents are cloned to a frozen JSON-safe value. Valid `Date`
instances become ISO strings. Accessors, symbols, custom prototypes, cycles,
non-finite numbers, BigInts, functions, sparse/extended arrays, oversized
documents, and malformed Unicode fail the contract.

Every result document must include a stable string `id`, canonical `siteId`,
canonical `status`, and `visibility`. Public searches additionally require
`status: "published"`, `visibility: "public"`, and the exact current site.
For a collection that declares `community.audience: true`, adapter results must
also include its canonical `audience`; public searches accept only `public`.
Missing, malformed, `members`, or `private` values fail the adapter result
contract before counts, facets, cache, or callers can observe the page.
Those required fields are represented statically by `NpSearchResultDocument`;
all other document fields use the recursive `NpSearchDocumentValue` JSON type.
Collection/id pairs must be unique. `perCollection` must include every
searched collection (including zero counts), sum exactly to `total`, and cover
every returned hit. Candidate rows must fill the normalized page exactly when
that page intersects `total`; partial pages are rejected. `hasNextPage` becomes
false at the maximum supported offset even when the backing index has more
rows, so callers are never directed to an invalid next request.

## External adapters

Prefer injecting an adapter through the Next bootstrap so installation,
rollback, and terminal cleanup share the process lifecycle:

```ts
import type { NpSearchAdapter } from "@nexpress/core/search";
import { createBootstrap } from "@nexpress/next";

const searchAdapter: NpSearchAdapter = {
  kind: "meilisearch",
  audience: "document-v1",
  async search(context) {
    // Apply context.audience.mode to every slug listed in
    // context.audience.collections before calculating hits or counts.
    const page = await searchIndex(context);
    return {
      results: page.hits,
      total: page.total,
      perCollection: page.counts,
    };
  },
};

const bootstrap = createBootstrap({
  config,
  generatedSchema,
  searchAdapter,
});
```

The adapter descriptor is exact: canonical `kind`, required
`audience: "document-v1"`, `search()`, and optional terminal `shutdown()` that
must resolve to void. Existing adapters must add that declaration and apply the
new scope before upgrading. `NpSearchAdapterContext` contains normalized `q`,
`limit`, `offset`, resolved `siteId`, and `visibility`, plus optional
`collections` and `locale`. Its required framework-derived `audience` object is
exactly `{ mode: "public" | "all", collections: string[] }`. The list contains
only selected collections that opted into `community.audience`; it can be empty
or represent one subset of a mixed catalog. Adapters must filter both hits and
`total` / `perCollection` counts by that scope. They own only the candidate
envelope: `results`, `total`, and `perCollection`.

Framework code that previously constructed an adapter context directly should
first build an exact `NpSearchResolvedRequest`, then call
`resolveSearchAdapterContext()` after collections are registered. The resolver
derives the complete audience inventory from active collection definitions;
callers must not guess or accept that inventory from an HTTP request.

Return `null`/`undefined` to deliberately use the built-in Postgres path. A
throwing adapter or malformed adapter result is contained, reported through
the configured logger/error reporter, counted in process diagnostics, and
falls back to Postgres. It is never cached or sent to a caller. Custom hosts
and tests may still use `setSearchAdapter()` / `resetSearchAdapter()` directly;
replacement resets stale diagnostics, and owner-aware reset does not detach a
newer replacement. Custom hosts use `shutdownSearchAdapter()` for terminal
resource cleanup.

## Built-in Postgres path and cache

The built-in path queries each registered collection with a `search_vector`,
applies the exact site/visibility/status scope through `findDocuments()`, and
globally reranks the bounded candidates. Locale filtering applies to i18n
collections and is ignored by non-i18n collections.

The public Next cache key includes site, normalized query, collection order,
limit, offset, locale, visibility, the `document-v1` contract marker, audience
mode, and the ordered audience-aware collection subset. Cross-site
`siteId: "*"` and trusted `visibility: "all"` requests are rejected before the
public cache. Both cache hits and the direct fallback path revalidate the
complete result contract, including required public audiences.

## Reindex and operations

`reindexCollection(slug)` accepts one canonical registered searchable
collection and returns exact `{ collection, processed }`. The internal
`POST /api/internal/reindex?collection=<slug>` endpoint rejects unknown,
duplicate, or malformed query parameters and returns exact aggregate totals.

Admin Health shows `built-in Postgres tsvector` or the exact external adapter
kind plus its `document-v1` audience contract. Contained dispatch,
result-contract, and shutdown failures produce a warning with the last failure.
Process code can read the same counters and active audience contract with
`getSearchAdapterDiagnostics()`.
