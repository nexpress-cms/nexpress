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
  indexing: {
    contract: "document-v1",
    async write(mutation) {
      // Upsert or delete by collection + siteId + documentId. Use
      // observedAt to reject an older operation after a newer one.
      await applyLatestMutation(mutation);
    },
    async replaceCollection(context) {
      // Stage this all-site snapshot, consume the one-shot stream fully,
      // then publish it atomically without losing overlapping write() calls.
      await replaceIndexGeneration(context);
    },
  },
};

const bootstrap = createBootstrap({
  config,
  generatedSchema,
  searchAdapter,
});
```

The adapter descriptor is exact: canonical `kind`, required
`audience: "document-v1"`, `search()`, optional `indexing`, and optional terminal
`shutdown()` that must resolve to void. Query-only adapters remain valid and
can omit `indexing`. When present, indexing is the exact
`{ contract: "document-v1", write, replaceCollection }` capability; both
methods must resolve to void. `NpSearchAdapterContext` contains normalized `q`,
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

### External index synchronization

`indexing.write()` receives one frozen, exact `NpSearchIndexMutation`. The
identity is always `collection + siteId + documentId`:

- `upsert` includes the complete validated JSON-safe `doc`. It carries every
  document status and visibility because trusted `visibility: "all"` queries
  may need them. Audience-aware collections always include canonical
  `audience`.
- `delete` contains only the identity and timing metadata. It does not expose a
  deleted document snapshot.
- both variants include canonical `observedAt`. Adapters must apply mutations
  idempotently and must not let an older observation overwrite a newer one.

Durable `content:afterSave` and `content:afterDelete` jobs dispatch these
mutations. The worker re-reads the document at execution time rather than
trusting the historical job operation: an existing row becomes `upsert`, and a
missing row becomes `delete`. Delayed, duplicated, or reordered content jobs
therefore converge on the latest persisted state. A query-only adapter is a
no-op before hydration. A throwing indexing method or a non-void result is
reported, counted, and rethrown so pg-boss retries it; index writes never fall
back to Postgres as a substitute for synchronizing the external service.
After enabling `indexing` for an existing deployment, run the internal reindex
endpoint once to seed rows whose content jobs completed before the capability
was installed.

`replaceCollection()` participates in `reindexCollection()`. It receives one
frozen `NpSearchIndexReplaceContext` for a collection across all sites:
`{ collection, siteId: "*", startedAt, documents }`. `documents` is a one-shot
`AsyncIterable<NpSearchIndexUpsert>` so the adapter contract does not require
a second in-memory document batch. The adapter must consume it completely
before resolving, including for an empty collection. Resolving early, returning a value, or
throwing fails the reindex and increments `indexReplaceFailures`.

Replacement is a concurrency contract as well as a transport API. Stage the
snapshot, preserve any `write()` mutation newer than `startedAt` / its
`observedAt`, remove only stale entries in the collection scope, and publish
the replacement atomically. A generation swap, provider-side run marker, or
equivalent transactional mechanism is appropriate. An implementation that
blindly deletes and reinserts into the live generation can lose writes that
overlap reindex and does not satisfy `document-v1`.

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
collection, rebuilds its Postgres vectors, and, when the installed adapter
declares `indexing`, replaces that external collection snapshot. It returns
exact `{ collection, processed }`. Both phases use an id-ordered cursor and
fixed 100-row batches: the Postgres pass retains only one row batch, and the
external pass selects only `id + siteId` before hydrating each latest document
into the one-shot adapter stream. The implementation therefore no longer
materializes a whole-collection row or id array in memory.

Long-running operator work uses the exact built-in `search:reindex` job with
payload `{ collection: "posts" }`. It retries from a fresh idempotent pass,
records start/progress/completion in the standard job log, and uses a
collection-keyed pg-boss stately queue so two workers never reindex the same
collection concurrently. Different collections remain independently
retryable. The queue has a six-hour expiry rather than pg-boss's short default.
Producer and worker startup both create or reconcile that queue, so an internal
trigger can safely run before the dedicated worker process comes online. The
stately policy is fixed when the queue is created; startup fails with a repair
instruction if an operator previously created that queue under another policy,
because pg-boss does not permit in-place policy changes.

The bearer-protected `POST /api/internal/reindex?collection=<slug>` endpoint
now enqueues that durable job instead of holding the HTTP request open. Omit
`collection` to enqueue each registered searchable collection independently.
The exact 202 response is `{ requested, enqueued, failures }`, so a partial
enqueue never hides which collection needs a retry. Unknown, duplicate, or
malformed query parameters fail before queue access; a total enqueue failure
returns 503, while an already queued or active request returns 409.
`/admin/jobs` exposes the same handler with a selector derived from registered
searchable collections instead of requiring hand-written JSON.

Admin Health shows `built-in Postgres tsvector` or the exact external adapter
kind plus its `document-v1` audience contract and `query-only` or indexing
capability. Dispatch, result-contract, index-write, index-replace, and shutdown
failures produce a warning with the last failure. Process code can read the
same counters and active contracts with `getSearchAdapterDiagnostics()`.
