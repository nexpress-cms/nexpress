# Collection document contracts

Collection documents use one definition-derived contract across Postgres,
Core, generated types, the Admin, REST responses, OpenAPI, and site-config
import/export. A malformed persisted row or hook result fails closed instead
of reaching rendering code as a partially trusted object.

## The three shapes

1. **Storage row** — the generated `np_c_<slug>` table. Group fields are
   flattened, arrays live in child tables, and `hasMany` relationships live in
   join tables. `searchVector` remains internal.
2. **Runtime document** — returned by `saveDocument`, `findDocuments`, and
   `getDocumentById`. It contains every system and declared field, uses `Date`
   instances, reconstructs groups, and hydrates arrays/`hasMany` values in
   stored order.
3. **Wire document** — the REST/Admin/import-export form. It has the same exact
   keys as the runtime document, with every `Date` recursively converted to a
   canonical UTC ISO string.

Optional scalar and group fields are present as `null`. Array and `hasMany`
fields are always arrays, including when empty. Unknown or missing keys,
malformed rich text/block content, invalid UUIDs/dates/enums, duplicate
relationships, and broken relation ordering are contract errors.

Slug-bearing documents expose only the canonical slug produced by NexPress:
the reserved page-root sentinel `/`, or at most 96 lowercase Unicode
letters/numbers arranged into `/`-separated relative-path segments with single
hyphen separators inside each segment. This keeps nested page paths such as
`about/team` exact while rejecting leading/trailing or repeated slashes.
Explicit slugs that normalize to an empty value are rejected. JSON fields are
bounded recursive JSON values; functions, `undefined`, custom prototypes,
circular references, excessive depth, and excessive inventories are rejected
at the write boundary.

Every document includes `id`, canonical `status`, `createdBy`, `updatedBy`,
`visibility`, and `siteId`. Timestamp-enabled collections also include
`createdAt` and `updatedAt`; slug, i18n, member-author, and framework
`publishedAt` fields appear when their collection capabilities require them.

`_status` is only a REST write sentinel. It selects the requested transition
and is never stored or returned. The persisted and response field is `status`.

## Core and generated APIs

Use the server-only collection surface for data access:

```ts
import { findDocuments, saveDocument } from "@nexpress/core/collections";

const page = await findDocuments("posts", {
  page: 1,
  limit: 20,
  sort: "-updatedAt",
  where: { status: "published" },
});

// Updates are true patches. Omitted declared fields retain their stored value.
await saveDocument("posts", page.docs[0]!.id as string, { title: "Updated" }, user);
```

Generated `db/generated/documents.ts` modules expose an exact
`<Collection>Document` runtime interface and a
`<Collection>DocumentWire` alias. Runtime consumers should not cast raw SQL
rows to these types.

The client-safe `@nexpress/core/collection-contract` subpath exports analyzers
and throwing helpers for trusted boundaries:

- `npHydrateCollectionDocument`
- `npSerializeCollectionDocument` / `npParseCollectionDocumentWire`
- `npAnalyzeCollectionDocument` / `npAnalyzeCollectionDocumentWire`
- `npAnalyzeCollectionStorageRow`
- `npAnalyzeCollectionJsonValue`
- `npNormalizeCollectionDocumentSlug`
- `npAnalyzeCollectionFindOptions` / `npAnalyzeCollectionFindResult`
- `npCollectionDocumentToWriteInput`

Server response code should use
`npSerializeCollectionDocumentWithDiagnostics` from
`@nexpress/core/collections`; it applies the same wire contract and records a
bounded live-health diagnostic when serialization fails. Browser code uses the
client-safe helper directly.

`npCollectionDocumentToWriteInput` is the supported way to turn a validated
runtime document back into write data for restore, bulk, translation, or
cleanup workflows. It removes framework-owned fields while retaining declared
content and explicit write controls.

## REST and OpenAPI

OpenAPI publishes three closed schemas per collection:

- `<slug>_document` — exact response wire document.
- `<slug>_create_input` — closed create body; declared required fields remain
  required.
- `<slug>_patch_input` — closed partial update body.

Unknown/duplicate query parameters, unknown `where` fields, invalid values,
ambiguous duplicate locale filters, unsafe pagination offsets, and public
`siteId`/`visibility` filters are rejected. Internal Core callers may use the
documented scalar `"*"` tenant/visibility sentinel explicitly.

## Persistence, hooks, and operations

Collection registration requires the exact generated child/join-table
inventory before startup, and hydration requires an explicit inventory for
every declared array and `hasMany` field. Writes validate the complete candidate
before and after `beforeCreate`/`beforeUpdate` hooks. Reads validate storage plus
related rows before `beforeRead`/`afterRead`; every hook result is revalidated
before it is returned or persisted. Collection `afterCreate`, `afterUpdate`,
`beforeDelete`, and `afterDelete` hooks run alongside plugin lifecycle hooks.

`pnpm run doctor` reports `collections.contract` by inspecting every collection
table's canonical system envelope and flags legacy `_status` columns. Live
health reports any contained hydration, hook-result, or serialization failure
as `Collection document contracts`. Regenerate and migrate after any collection
definition change:

```bash
pnpm schema:gen
pnpm db:generate
pnpm db:migrate
```

Site-config export format `3` stores exact wire documents. Import validates
the full collection contract during dry-run and reparses it again before the
write pass.
