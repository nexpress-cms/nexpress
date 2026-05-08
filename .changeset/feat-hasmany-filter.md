---
"@nexpress/core": minor
"@nexpress/web": patch
---

**Phase E — `hasMany` relationship filtering on `findDocuments` + typed wrappers.**

Closes the friction surfaced in #540's `/blog/category/[slug]`
dogfood. Sites can now write the natural query directly:

```ts
const result = await findPosts({
  where: { status: "published", categories: category.id },
  sort: "-publishedAt",
  page: pageNum,
  limit: 20,
});
```

…instead of dropping into raw Drizzle to subquery the join
table by hand (and remembering to re-apply the `siteId` /
`visibility` / `access.read` gates that `findDocuments` would
have applied for free).

### Three pieces

1. **`NpFindWhere<T>` accepts arrays per field** — the type
   `Partial<T>` is now `{ [K]?: Unwrap<T[K]> | Unwrap<T[K]>[] }`.
   Hand-typed scalars stay scalar; hasMany arrays unwrap so
   `categories: string[] | null` reads as `string | string[]`
   in where clauses (single target or OR-list of targets).

2. **`findDocuments` runtime auto-detects array values** — when
   `where[field]` is an array, the pipeline emits `inArray(col,
   value)` instead of `eq(col, value)`. Empty arrays
   short-circuit to a `false` SQL clause (Postgres rejects
   `IN ()` with a syntax error otherwise).

3. **Codegen typed wrappers pre-resolve hasMany fields** —
   `generateDocumentsModule` now detects top-level relationship
   fields with `hasMany: true` on each collection. Their
   `find${Pascal}` wrapper queries the join table for matching
   parent ids, intersects across multiple hasMany filters
   (`categories: x AND tags: y` matches rows that have BOTH),
   strips the hasMany keys from the where clause, adds
   `id: idList`, and delegates to `findDocuments`.

### Critically: gates preserved

Because the wrapper goes through `findDocuments`, all the
hardening that `findDocuments` already applied keeps applying:

- `siteId` scoping (multi-site)
- `visibility = "public"` for anonymous viewers
- `access.read({ user, doc })` callback per row

The cookbook §2.1 (raw Drizzle escape hatch) is rewritten —
the natural typed-wrapper path is now the recommended one,
with a much smaller "when you still need raw Drizzle" callout
for exotic shapes (full-text ranking, JSON-column queries).

### Reference app migration

`apps/web/src/app/(site)/blog/category/[slug]/page.tsx` is
refactored from ~70 lines of raw Drizzle (with the security-
critical gate-restoration code) to a single 8-line `findPosts`
call. Same behavior, much smaller surface to reason about.

### Tests

5 new unit tests in `type-generator.test.ts` assert:
- Simple wrapper for hasMany-free collections (no async, no
  drizzle imports)
- Hasn't-aware async wrapper for collections with hasMany
- Multiple hasMany fields produce multiple descriptors
- Intersect short-circuit behavior is documented in the output
- `getDb` import only appears when at least one collection
  needs it

Total core tests: 280 (5 new).

### Stability

`NpFindWhere<T>` shape change is backwards-compatible: with
the default `T = Record<string, unknown>` the per-field type
is `unknown | unknown[]` which subsumes the previous
`Record<string, unknown>` (no caller could pass an array
before; now they can). Joins v0.1's stable surface as the
recommended hasMany-filter path.
