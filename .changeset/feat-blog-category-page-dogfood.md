---
"@nexpress/web": patch
---

**Phase 25.4 — `/blog/category/[slug]` dogfood + cookbook §2.1 hasMany friction note.**

Built `apps/web/src/app/(site)/blog/category/[slug]/page.tsx`
to exercise category-filtered post listings with the Phase D
typed wrappers. The first instinct doesn't work:

```ts
const result = await findPosts({
  where: { categories: [category.id], status: "published" },
  // ...
});
```

`findDocuments`'s where clause iterates `Object.entries` and
calls `eq(column, value)` per field. There's no `categories`
column on `np_c_posts` — the relationship lives in
`np_c_posts__categories`, a join table. The typed wrapper lets
you SPELL `categories: [id]` (it's on `PostsDocument`) but the
runtime ignores it and the query throws "column 'categories'
doesn't exist."

The page works around this with a raw-Drizzle subquery against
the join table. Cookbook §2.1 ("Filtering by `hasMany`
relationships — raw Drizzle") documents the pattern with a
copyable code snippet pointing at this page as the reference.

**Phase E candidate.** A typed `findPostsByCategories(id)`
emitted alongside the existing `find${Pascal}` wrappers would
hide this boilerplate. Two pieces would need to land together:

1. `findDocuments`'s where clause auto-detects array values
   and uses `inArray` instead of `eq`.
2. Codegen's `generateDocumentsModule` emits per-hasMany-
   relationship helpers that pre-resolve the join table to an
   id list, then delegate to `findDocuments({ id: idList })`.

Implementation is moderate but not in this PR. Filed as a
follow-up issue; the raw-Drizzle pattern works and ships.

No framework code changes in this PR — pure dogfood + docs.
