---
"@nexpress/core": minor
"@nexpress/web": patch
---

**Phase D — typed collection reads + small DX wins from Phase C dogfooding.**

Phase C surfaced four friction points; the big one (#7+#8) gets a
proper codegen-typed surface, and the smaller two (#9, #11) get
reference patterns documented + demonstrated.

### #7 + #8 — typed collection reads

`pnpm db:generate` now also emits
`apps/<app>/src/db/generated/documents.ts` alongside the existing
`collections.ts` (Drizzle schema). The new file declares one
`${Pascal}Document` interface per collection plus
`find${Pascal}` / `get${Pascal}Document` wrappers that bind the
type generic. Result: read-site casts disappear.

```ts
// before
const result = await findDocuments("discussions", { ... });
const slug = doc.slug as string;
const title = doc.title as string;
const createdAt = doc.createdAt as Date;

// after
import { findDiscussions } from "@/db/generated/documents";
const result = await findDiscussions({ ... });
// doc.slug, doc.title, doc.createdAt — typed, no casts
```

The framework surface that supports this:

- **`NpFindOptions<T>`** is now generic. With the default
  `T = Record<string, unknown>` it behaves exactly as before
  (back-compat). With a typed `T`, `where: Partial<T>` rejects
  field-name typos at compile time.
- **`NpFindWhere<T>` + `NpFindWhereSystemTokens`** — the where
  clause merges the document fields with system-level escape
  hatches (`siteId`, `visibility`, `locale`) so advanced callers
  don't lose access to those.
- **`findDocuments<T>(collection, options, user?)`** propagates
  the generic through to `Promise<NpFindResult<T>>`. Uses
  `NoInfer<T>` on the options parameter to prevent TS from
  inferring T from a partial where clause — callers either pass
  the generic explicitly (typed) or accept the
  `Record<string, unknown>` default.
- **`getDocumentById<T>(collection, id, user?)`** same generic
  propagation.
- **`generateDocumentsModule(collections)`** — new exported
  generator that produces the full `documents.ts` content
  (imports + interfaces + read-helper wrappers).

The untyped `findDocuments(slug, options)` from `@nexpress/core`
still works for back-compat and stays the right call when you
genuinely need an untyped escape hatch.

### #11 — dedupe expensive primitive calls across `generateMetadata` + page

`apps/web/src/lib/cached-content.ts` wraps `getMemberProfile`
with React's `cache()`. Pages that call the same primitive in
both `generateMetadata` and the page body get a single fetch for
free. `/u/[handle]/discussions/page.tsx` migrated to demonstrate.

Cookbook documents the pattern; covers the argument-tuple
caveat (different `avatarVariant` → different fetches → same
behavior as before).

### #9 — pagination reference component

`apps/web/src/components/pagination-nav.tsx` — small reference
component. The framework intentionally doesn't ship a
`<Pagination />` because visual treatment is theme territory;
the data shape is already on `NpFindResult`
(`hasPrevPage` / `hasNextPage` / `page` / `totalPages`). The
component takes a `hrefForPage(p)` callback so the caller owns
URL composition (preserving `?author=me` etc.). Migrated
`/discussions/page.tsx` and `/u/[handle]/discussions/page.tsx`.

### Stability

`NpFindOptions<T>` and `NpFindWhere<T>` join v0.1's stable
surface. `findDocuments<T>` / `getDocumentById<T>` stable. The
generated `documents.ts` is app-owned codegen output (not part
of the framework's public surface), but the
`generateDocumentsModule` function and the per-collection
naming convention (`${Pascal}Document`, `find${Pascal}`,
`get${Pascal}Document`) are stable — apps that vendored the
generator will see the same shape as the official one.
